"""Tests for the lead follow-up state machine (docs/LEAD_FOLLOWUP_PLAN.md).

No network and no real database: a FakeDb evaluates the SQLAlchemy where
clauses against in-memory rows (real select logic, no engine), and the four
network seams (m365 / whatsapp / telegram / LLM) are stubbed by the autouse
``net`` fixture — a test in this module can never reach the network.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Select
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import (
    BinaryExpression,
    BooleanClauseList,
    UnaryExpression,
)

from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    Contact,
    ContactMailPhone,
    Conversation,
    ExternalIdentity,
    Message,
    Opportunity,
    Organization,
    OrganizationContact,
)
from app.models.lead_followup import LeadFollowup, LeadFollowupLog
from app.services import lead_followup as lf

# 2026-11-15 10:00 UTC = 11:00 Europe/Zurich (CET) — inside quiet-hours window
NOW = datetime(2026, 11, 15, 10, 0, tzinfo=UTC)
DUMMY_DT = datetime(1970, 1, 1, tzinfo=UTC)


def admin_headers() -> dict:
    """The shared _require_admin_token gate: NEEDLE_TOKEN or API_SECRET_KEY
    (local .env carries both; mirror ibkr tests and resolve at call time)."""
    token = settings.NEEDLE_TOKEN or settings.API_SECRET_KEY
    return {"Authorization": f"Bearer {token}"}


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- #
# FakeDb: evaluates real where clauses / order / limit against in-memory rows. #
# --------------------------------------------------------------------------- #
def _unwrap_name(clause) -> str:
    name = getattr(clause, "name", None)
    if not isinstance(name, str):
        raise TypeError(f"unsupported column in fake where: {clause!r}")
    return name


def _eval_clause(clause, row) -> bool:
    if clause is None:
        return True
    if isinstance(clause, BooleanClauseList):
        vals = [_eval_clause(c, row) for c in clause.clauses]
        return any(vals) if clause.operator is operators.or_ else all(vals)
    if isinstance(clause, BinaryExpression):
        value = getattr(row, _unwrap_name(clause.left), None)
        op = clause.operator
        if op in (operators.is_, operators.is_not):
            is_null = value is None
            return is_null if op is operators.is_ else not is_null
        if op is operators.in_op:
            right = clause.right
            wanted = getattr(right, "value", None)
            if isinstance(wanted, (list, tuple, set)):
                return value in wanted
            exprs = getattr(right, "exprs", None) or getattr(
                right, "expressions", None
            )
            if exprs is None:
                raise AssertionError(f"unsupported in_ clause: {clause!r}")
            return value in [getattr(e, "value", e) for e in exprs]
        right = clause.right
        other = getattr(right, "value", None)
        if other is None and right.__class__.__name__ == "Null":
            raise AssertionError("Null comparisons unsupported in fake")
        if op is operators.eq:
            return value == other
        if op is operators.ne:
            return value != other
        if op is operators.ge:
            return value is not None and value >= other
        if op is operators.le:
            return value is not None and value <= other
        if op is operators.gt:
            return value is not None and value > other
        if op is operators.lt:
            return value is not None and value < other
        raise AssertionError(f"unsupported operator in fake: {op!r}")
    raise AssertionError(f"unsupported where clause in fake: {clause!r}")


def _sorted_limited(rows, stmt):
    for ob in reversed(getattr(stmt, "_order_by_clauses", ()) or ()):
        reverse = False
        element = ob
        if isinstance(ob, UnaryExpression):
            reverse = ob.operator is operators.desc_op
            element = ob.element
        name = _unwrap_name(element)
        rows.sort(
            key=lambda r, n=name: getattr(r, n, None) or DUMMY_DT,
            reverse=reverse,
        )
    lim = getattr(stmt, "_limit_clause", None)
    if lim is not None:
        value = getattr(lim, "effective_value", None)
        if value is None:
            value = getattr(lim, "value", None)
        if isinstance(value, int):
            rows = rows[:value]
    return rows


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def one_or_none(self):
        assert len(self._rows) <= 1, f"one_or_none got {len(self._rows)} rows"
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0] if self._rows else None


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarResult(self._rows)


_STORES = {
    Contact: "contacts",
    LeadFollowup: "followups",
    LeadFollowupLog: "logs",
    Conversation: "conversations",
    Message: "messages",
    ContactMailPhone: "points",
    ExternalIdentity: "identities",
    Opportunity: "opportunities",
    OrganizationContact: "org_links",
    Organization: "orgs",
}


class FakeDb:
    """Minimal AsyncSession stand-in covering exactly the calls the service
    and the two admin handlers make: select/where/order/limit, add, commit."""

    def __init__(self, **stores):
        self.commits = 0
        for name in _STORES.values():
            setattr(self, name, list(stores.get(name, ())))

    def add(self, obj):
        if isinstance(obj, LeadFollowup):
            self.followups = [f for f in self.followups
                              if f.contact_id != obj.contact_id]
            self.followups.append(obj)
        elif isinstance(obj, LeadFollowupLog):
            self.logs.append(obj)
        else:
            raise TypeError(f"FakeDb.add cannot place {type(obj)!r}")

    async def commit(self):
        self.commits += 1

    async def execute(self, stmt):
        if not isinstance(stmt, Select):
            raise TypeError(f"fake session only supports Select, got {stmt!r}")
        entity = stmt.column_descriptions[0]["entity"]
        store = getattr(self, _STORES[entity])
        rows = [r for r in store
                if _eval_clause(getattr(stmt, "whereclause", None), r)]
        return _Result(_sorted_limited(list(rows), stmt))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


# --------------------------------------------------------------------------- #
# Factories + network stubs                                                     #
# --------------------------------------------------------------------------- #
def make_contact(**kw) -> Contact:
    defaults = {
        "id": uuid4(),
        "first_name": "Anna",
        "last_name": "Tester",
        "lifecycle_stage": "lead",
        "consent_status": "lead_form",
        "consent_source": "website_form",
        "suppressed": False,
        "preferred_language": "de-CH",
        "created_at": NOW - timedelta(hours=5),
        "updated_at": NOW - timedelta(hours=5),
    }
    defaults.update(kw)
    return Contact(**defaults)


def make_row(contact_id, *, step=1, status="pending",
             next_due=None, last_sent=None) -> LeadFollowup:
    return LeadFollowup(
        contact_id=contact_id,
        step=step,
        status=status,
        last_sent_at=last_sent,
        next_due_at=next_due,
        created_at=NOW - timedelta(hours=3),
        updated_at=NOW - timedelta(hours=3),
    )


def make_conv(contact_id, channel="telegram") -> Conversation:
    return Conversation(
        id=uuid4(), contact_id=contact_id, channel=channel,
        status="active", language="de-CH",
        started_at=NOW - timedelta(hours=5),
    )


def make_msg(conversation_id, at, text, sender="visitor") -> Message:
    return Message(
        conversation_id=conversation_id, sender_type=sender,
        content=text, created_at=at,
    )


def email_point(contact_id, value="anna@example.com") -> ContactMailPhone:
    return ContactMailPhone(
        id=uuid4(), contact_id=contact_id, channel_type="email",
        value=value, label="work", is_primary=True,
    )


def wa_point(contact_id, value="+41790000001") -> ContactMailPhone:
    """Mirror of agent_core's WhatsApp backfill: phone_mobile + label whatsapp."""
    return ContactMailPhone(
        id=uuid4(), contact_id=contact_id, channel_type="phone_mobile",
        value=value, label="whatsapp", is_primary=True,
    )


def telegram_identity(contact_id, chat_id="777888") -> ExternalIdentity:
    return ExternalIdentity(
        id=uuid4(), contact_id=contact_id, channel="telegram",
        external_user_id=chat_id,
    )


class EmailStub:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls: list[tuple] = []

    async def send_confirmation_email(self, recipient, subject, body_html):
        self.calls.append((recipient, subject, body_html))
        return self.ok


class WhatsAppStub:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls: list[tuple] = []

    async def send_text_message(self, recipient, text):
        self.calls.append((recipient, text))
        return self.ok, "wamid.test.1", {}


@pytest.fixture(autouse=True)
def net(monkeypatch):
    """Stub ALL four network seams (autouse): m365, whatsapp, telegram, LLM.
    A test in this module can never reach the network."""
    ns = SimpleNamespace(
        email=EmailStub(),
        whatsapp=WhatsAppStub(),
        telegram=[],
        llm=[],
        llm_result={"subject": "Ihr Interesse an der H2",
                    "body": "Guten Tag, vielen Dank für Ihre Anfrage."},
        llm_error=None,
        telegram_ok=True,
    )
    monkeypatch.setattr(lf, "m365_service", ns.email)
    monkeypatch.setattr(lf, "whatsapp_service", ns.whatsapp)

    async def _telegram(chat_id, text):
        ns.telegram.append((chat_id, text))
        return ns.telegram_ok, "42", None

    async def _llm(system, user):
        ns.llm.append((system, user))
        if ns.llm_error is not None:
            raise ns.llm_error
        return dict(ns.llm_result), "mimo", "mimo-flash"

    monkeypatch.setattr(lf, "_send_telegram", _telegram)
    monkeypatch.setattr(lf, "_llm_chat", _llm)
    return ns


# --------------------------------------------------------------------------- #
# 1. Config default + candidate selection (incl. every skip reason)            #
# --------------------------------------------------------------------------- #
def test_config_defaults_are_off_and_capped():
    assert settings.LEAD_FOLLOWUP_ENABLED is False
    assert settings.LEAD_FOLLOWUP_MAX_TOUCHES == 3
    assert settings.LEAD_FOLLOWUP_MAX_PER_DAY == 25
    assert settings.LEAD_FOLLOWUP_QUIET_START == 8
    assert settings.LEAD_FOLLOWUP_QUIET_END == 18


def test_select_due_lead_form_consent():
    contact = make_contact()
    db = FakeDb(contacts=[contact])
    out = run(lf.select_candidates(db, NOW))
    assert [c.id for c in out] == [contact.id]


@pytest.mark.parametrize("consent", ["unknown", "denied"])
def test_select_skips_consent_not_allowlisted(consent):
    contact = make_contact(consent_status=consent)
    db = FakeDb(contacts=[contact])
    assert run(lf.select_candidates(db, NOW)) == []
    reason = lf.candidate_skip_reason(contact, None, NOW)
    assert reason == "consent_not_allowed"


def test_select_skips_suppressed_contact():
    contact = make_contact(suppressed=True, suppression_reason="manual")
    db = FakeDb(contacts=[contact])
    assert run(lf.select_candidates(db, NOW)) == []
    assert lf.candidate_skip_reason(contact, None, NOW) == "suppressed"


def test_select_skips_lead_older_than_7_days():
    contact = make_contact(created_at=NOW - timedelta(days=8, hours=1))
    db = FakeDb(contacts=[contact])
    assert run(lf.select_candidates(db, NOW)) == []
    assert lf.candidate_skip_reason(contact, None, NOW) == "lead_too_old"


def test_step1_due_at_two_hours_after_creation():
    fresh = make_contact(created_at=NOW - timedelta(hours=1))
    assert lf.candidate_skip_reason(fresh, None, NOW) == "not_due_yet"
    fresh.created_at = NOW - timedelta(hours=2)
    assert lf.candidate_skip_reason(fresh, None, NOW) is None


def test_inbound_restarts_the_t_plus_2h_anchor():
    contact = make_contact(created_at=NOW - timedelta(hours=5))
    # lead messaged 1h ago -> step 1 waits until that inbound + 2h
    assert lf.candidate_skip_reason(
        contact, None, NOW, NOW - timedelta(hours=1)
    ) == "not_due_yet"
    # ... and is due once 2h since that inbound passed
    assert lf.candidate_skip_reason(
        contact, None, NOW, NOW - timedelta(hours=2)
    ) is None


def test_select_skips_non_lead_lifecycle():
    contact = make_contact(lifecycle_stage="customer")
    assert lf.candidate_skip_reason(contact, None, NOW) == "not_lead"


@pytest.mark.parametrize(
    "status", ["stopped", "replied", "meeting_booked", "maxed"]
)
def test_terminal_rows_never_reenter(status):
    contact = make_contact()
    row = make_row(contact.id, status=status, step=3)
    db = FakeDb(contacts=[contact], followups=[row])
    assert run(lf.select_candidates(db, NOW)) == []
    assert lf.candidate_skip_reason(contact, row, NOW) == f"terminal_{status}"


def test_future_due_row_is_skipped_but_due_row_is_selected():
    contact = make_contact()
    waiting = make_row(contact.id, next_due=NOW + timedelta(hours=1))
    assert lf.candidate_skip_reason(contact, waiting, NOW) == "not_due"

    db = FakeDb(contacts=[contact], followups=[waiting])
    assert run(lf.select_candidates(db, NOW)) == []

    due = make_row(contact.id, next_due=NOW - timedelta(minutes=5))
    db2 = FakeDb(contacts=[contact], followups=[due])
    out = run(lf.select_candidates(db2, NOW))
    assert [c.id for c in out] == [contact.id]
    # 'active' (crash residue) counts as due exactly the same way
    active = make_row(contact.id, status="active",
                      next_due=NOW - timedelta(minutes=5))
    db3 = FakeDb(contacts=[contact], followups=[active])
    assert [c.id for c in run(lf.select_candidates(db3, NOW))] == [contact.id]


# --------------------------------------------------------------------------- #
# 2. Quiet hours, daily cap, cycle cap, max touches                            #
# --------------------------------------------------------------------------- #
def test_quiet_hours_defer_everything(net):
    contact = make_contact()
    db = FakeDb(contacts=[contact])
    night = datetime(2026, 11, 15, 22, 0, tzinfo=UTC)  # 23:00 Zurich
    out = run(lf.run_due(db, night))
    assert out["quiet_hours"] is True
    assert out["sent"] == [] and db.logs == [] and db.followups == []
    assert net.email.calls == []


def test_daily_cap_defers_and_halts_the_day(net, monkeypatch):
    monkeypatch.setattr(settings, "LEAD_FOLLOWUP_MAX_PER_DAY", 1)
    contact = make_contact()
    already_sent = LeadFollowupLog(
        contact_id=uuid4(), step=1, channel="email", status="ok",
        created_at=NOW - timedelta(hours=1),
    )
    db = FakeDb(contacts=[contact], logs=[already_sent])
    out = run(lf.run_due(db, NOW))
    assert out["daily_cap_hit"] is True
    assert out["sent"] == [] and net.email.calls == []
    assert [s["reason"] for s in out["skipped"]] == ["daily_cap"]
    assert len(db.logs) == 2  # the seeded ok row + today's skip entry
    skip = [r for r in db.logs if r.status == "skipped"]
    assert skip[0].detail == "daily_cap"
    row = db.followups[0]
    assert row.status == "pending"
    # deferred to tomorrow 08:00 Zurich (today's window already started)
    assert row.next_due_at == datetime(2026, 11, 16, 8, 0,
                                       tzinfo=lf.TZ).astimezone(UTC)


def test_cycle_cap_limits_sends_per_run(net):
    contacts = [make_contact(created_at=NOW - timedelta(hours=5))
                for _ in range(11)]
    db = FakeDb(contacts=contacts,
                points=[email_point(c.id) for c in contacts])
    out = run(lf.run_due(db, NOW))
    assert len(out["sent"]) == lf.MAX_PER_CYCLE == 10
    assert out["skipped"][-1]["reason"] == "cycle_cap"
    assert len(net.email.calls) == 10


def test_touches_exhausted_stops_with_maxed():
    contact = make_contact()
    row = make_row(contact.id, step=4, next_due=NOW - timedelta(hours=1))
    info = lf.InboundInfo()
    stop = run(lf.evaluate_stops(FakeDb(), contact, row, NOW, info))
    assert stop == ("maxed", "touches_exhausted")


def test_after_final_touch_row_becomes_maxed(net):
    contact = make_contact()
    row = make_row(contact.id, step=3, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert len(out["sent"]) == 1
    assert db.followups[0].status == "maxed"
    assert db.followups[0].next_due_at is None
    assert out["sent"][0]["step"] == 3


# --------------------------------------------------------------------------- #
# 3. Channel rules: Meta 24h window, fallback order, contact points             #
# --------------------------------------------------------------------------- #
def _step2_setup(*, whatsapp_age, telegram, email):
    contact = make_contact()
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1))
    convs, msgs, points = [], [], []
    if whatsapp_age is not None:
        wa_conv = make_conv(contact.id, channel="whatsapp")
        convs.append(wa_conv)
        msgs.append(make_msg(wa_conv.id, NOW - whatsapp_age, "Hallo"))
        points.append(wa_point(contact.id))
    if telegram:
        points_tg = telegram_identity(contact.id)
    else:
        points_tg = None
    if email:
        points.append(email_point(contact.id))
    db = FakeDb(contacts=[contact], followups=[row], conversations=convs,
                messages=msgs, points=points,
                identities=[points_tg] if points_tg else [])
    return contact, row, db


def test_step2_sends_whatsapp_inside_24h_window(net):
    _, _, db = _step2_setup(whatsapp_age=timedelta(hours=23),
                            telegram=True, email=True)
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "whatsapp"
    assert net.whatsapp.calls and net.telegram == [] and net.email.calls == []


def test_step2_window_closed_at_24h_falls_back_to_telegram(net):
    _, _, db = _step2_setup(whatsapp_age=timedelta(hours=24),
                            telegram=True, email=True)
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "telegram"
    assert net.whatsapp.calls == [] and net.telegram and net.email.calls == []


def test_step2_no_telegram_falls_back_to_email(net):
    _, _, db = _step2_setup(whatsapp_age=timedelta(hours=30),
                            telegram=False, email=True)
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "email"
    assert net.whatsapp.calls == [] and net.telegram == []


def test_step1_prefers_email_even_with_open_whatsapp_window(net):
    contact = make_contact()
    conv = make_conv(contact.id, channel="whatsapp")
    db = FakeDb(
        contacts=[contact],
        conversations=[conv],
        # inbound 3h ago: step-1 anchor (inbound + 2h) is due, window still open
        messages=[make_msg(conv.id, NOW - timedelta(hours=3), "Hi")],
        points=[email_point(contact.id), wa_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "email"
    assert net.email.calls and net.whatsapp.calls == []


def test_step1_email_less_lead_falls_back_to_whatsapp(net):
    """WhatsApp-only inbound lead (agent_core stores ONLY the phone row):
    step 1 must still reach them via the open Meta window."""
    contact = make_contact(consent_status="granted",
                           consent_source="whatsapp_inbound")
    conv = make_conv(contact.id, channel="whatsapp")
    db = FakeDb(
        contacts=[contact],
        conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=3), "Hallo")],
        points=[wa_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "whatsapp"
    assert net.whatsapp.calls and net.email.calls == []


def test_whatsapp_never_sent_to_needle_operator_number(net):
    contact = make_contact(consent_status="granted")
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1))
    conv = make_conv(contact.id, channel="whatsapp")
    operator = settings.NEEDLE_OPERATOR_SENDERS.split(",")[0]
    db = FakeDb(
        contacts=[contact], followups=[row],
        conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=1), "Hi")],
        points=[wa_point(contact.id, operator)],
    )
    out = run(lf.run_due(db, NOW))
    assert net.whatsapp.calls == []
    assert [s["reason"] for s in out["skipped"]] == ["no_reachable_channel"]
    # defer, never terminal stop: the sequence must survive an unreachable
    # channel (operator number) and retry at the next allowed send window
    assert db.followups[0].status == "pending"
    assert db.followups[0].next_due_at is not None


def test_no_contact_point_and_no_identity_never_sends(net):
    contact = make_contact()
    row = make_row(contact.id, step=1, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row])
    out = run(lf.run_due(db, NOW))
    assert out["sent"] == []
    assert not (net.email.calls or net.whatsapp.calls or net.telegram)
    # unreachable defers (pending + future due), it never kills step 3
    assert db.followups[0].status == "pending"
    assert db.followups[0].next_due_at > NOW
    skipped = [r for r in db.logs if r.status == "skipped"]
    assert skipped[0].detail == "deferred_unreachable"


def test_step2_closed_window_no_telegram_falls_back_to_email(net):
    """Step 2 order = whatsapp(window) -> telegram -> email: with the Meta
    window closed and no telegram identity the touch still goes out via the
    stored email and the row advances to step 3 (the closing touch)."""
    contact = make_contact(created_at=NOW - timedelta(hours=30),
                           updated_at=NOW - timedelta(hours=30))
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1),
                   last_sent=NOW - timedelta(hours=24))
    conv = make_conv(contact.id, channel="whatsapp")
    db = FakeDb(
        contacts=[contact], followups=[row],
        conversations=[conv],
        # last INBOUND whatsapp 25h ago -> Meta 24h window is CLOSED
        messages=[make_msg(conv.id, NOW - timedelta(hours=25), "Hallo")],
        points=[email_point(contact.id), wa_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert [s["channel"] for s in out["sent"]] == ["email"]
    assert net.email.calls and net.whatsapp.calls == [] and not net.telegram
    follow = db.followups[0]
    assert follow.step == 3
    assert follow.status == "pending"
    assert follow.next_due_at == NOW + lf.NEXT_STEP_DELAY[3]


def test_step2_no_channel_at_all_defers_pending_24h_never_stops(net):
    """No channel at ANY step => DEFER: row stays pending with next_due_at =
    now + 24h and the audit says skipped/deferred_unreachable. 'stopped'
    stays reserved for evaluate_stops reasons and genuine completion."""
    contact = make_contact()
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1),
                   last_sent=NOW - timedelta(hours=2))
    db = FakeDb(contacts=[contact], followups=[row])  # no points, no identity
    out = run(lf.run_due(db, NOW))
    assert out["sent"] == []
    assert not (net.email.calls or net.whatsapp.calls or net.telegram)
    assert [s["reason"] for s in out["skipped"]] == ["no_reachable_channel"]
    assert out["skipped"][0]["deferred_to"] == (
        NOW + timedelta(hours=24)).isoformat()
    follow = db.followups[0]
    assert follow.status == "pending"                # NOT stopped
    assert follow.next_due_at == NOW + timedelta(hours=24)
    assert follow.next_due_at > NOW                  # future due
    entry = next(r for r in db.logs if r.status == "skipped")
    assert entry.detail == "deferred_unreachable"
    # the sequence stays alive: waits while not due, is re-selected once due
    assert lf.candidate_skip_reason(
        contact, follow, NOW + timedelta(hours=1)) == "not_due"
    due = run(lf.select_candidates(db, NOW + timedelta(hours=25)))
    assert [c.id for c in due] == [contact.id]


def test_whatsapp_window_boundary_is_strict_24h():
    info = lf.InboundInfo(last_whatsapp_at=NOW - timedelta(hours=23,
                                                           minutes=59))
    assert lf.whatsapp_window_open(info, NOW) is True
    info = lf.InboundInfo(last_whatsapp_at=NOW - timedelta(hours=24))
    assert lf.whatsapp_window_open(info, NOW) is False
    info = lf.InboundInfo(last_whatsapp_at=None)
    assert lf.whatsapp_window_open(info, NOW) is False


def test_resolve_channel_never_picks_unused_channel_without_contact_point():
    info = lf.InboundInfo(last_whatsapp_at=NOW - timedelta(hours=1))
    points = [email_point(uuid4())]
    target, reason = lf.resolve_channel(points, None, 2, info, NOW)
    # whatsapp window is open but there is no phone row -> email fallback
    assert target.channel == "email" and reason is None
    target, reason = lf.resolve_channel([], None, 1, info, NOW)
    assert target is None and reason == "no_reachable_channel"


def test_step3_final_email_carries_booking_link_and_no_marketing(net):
    contact = make_contact()
    row = make_row(contact.id, step=3, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "email"
    _recipient, _subject, body_html = net.email.calls[0]
    assert body_html.startswith("<p>")  # plain-text draft, HTML-escaped
    # the LLM system prompt (used when the chain is up) mandates the link
    # verbatim for step 3, so BOTH draft sources carry it (template test below)
    system, _user = net.llm[-1]
    assert lf.BOOKING_LINK in system
    assert "no other offers, no marketing" in system.lower()


def test_step3_template_fallback_still_carries_booking_link(net):
    """With the LLM down the pre-written step-3 template guarantees the link."""
    net.llm_error = RuntimeError("chain down")
    contact = make_contact()
    row = make_row(contact.id, step=3, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["source"] == "template"
    assert lf.BOOKING_LINK in net.email.calls[0][2]


# --------------------------------------------------------------------------- #
# 4. STOP conditions evaluated before every send                               #
# --------------------------------------------------------------------------- #
def test_stop_replied_after_last_touch(net):
    contact = make_contact()
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1),
                   last_sent=NOW - timedelta(hours=2))
    conv = make_conv(contact.id, channel="telegram")
    db = FakeDb(
        contacts=[contact], followups=[row],
        conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(minutes=30),
                           "Ja gerne, wann passt es?")],
        points=[email_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls
    assert db.followups[0].status == "replied"
    assert [s["status"] for s in out["stopped"]] == ["replied"]
    entry = next(r for r in db.logs if r.status == "skipped")
    assert entry.detail == "inbound_after_last_touch"


def test_stop_meeting_booked_via_lead_lifecycle(net):
    contact = make_contact(lifecycle_stage="opportunity")
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1),
                   last_sent=NOW - timedelta(days=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls
    assert db.followups[0].status == "meeting_booked"
    assert out["stopped"][0]["reason"].startswith("lifecycle_")


def test_stop_consent_revoked_mid_sequence(net):
    contact = make_contact(consent_status="denied")
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls
    assert db.followups[0].status == "stopped"
    assert out["stopped"][0]["reason"] == "consent_not_allowed"


def test_stop_optout_keyword_suppresses_and_persists(net):
    contact = make_contact()
    row = make_row(contact.id, step=1, next_due=NOW - timedelta(minutes=1))
    conv = make_conv(contact.id, channel="whatsapp")
    db = FakeDb(
        contacts=[contact], followups=[row],
        conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=3), "STOP")],
        points=[email_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls
    assert db.followups[0].status == "stopped"
    assert out["stopped"][0]["reason"] == "opt_out_keyword"
    assert db.contacts[0].suppressed is True
    assert db.contacts[0].suppression_reason == "followup_keyword_opt_out"


def test_step2_optout_still_stops_terminal(net):
    """Terminal 'stopped' remains ONLY for evaluate_stops reasons: an
    opt-out stops the sequence at step 2 — it is never deferred the way
    mere unreachability is."""
    contact = make_contact()
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1),
                   last_sent=NOW - timedelta(hours=2))
    conv = make_conv(contact.id, channel="whatsapp")
    db = FakeDb(
        contacts=[contact], followups=[row],
        conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(minutes=30), "STOP")],
        points=[email_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls and not net.whatsapp.calls
    assert out["stopped"][0]["reason"] == "opt_out_keyword"
    follow = db.followups[0]
    assert follow.status == "stopped"
    assert follow.next_due_at is None
    entry = next(r for r in db.logs if r.status == "skipped")
    assert entry.detail == "opt_out_keyword"


def test_stop_suppression_flag_blocks_before_any_send(net):
    contact = make_contact(suppressed=True)
    row = make_row(contact.id, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls
    assert out["stopped"][0]["reason"] == "opt_out_suppressed"


def test_stop_lead_too_old_mid_sequence(net):
    contact = make_contact(created_at=NOW - timedelta(days=8))
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1))
    db = FakeDb(contacts=[contact], followups=[row],
                points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert not net.email.calls
    assert out["stopped"][0]["reason"] == "lead_too_old"


def test_inbound_before_last_touch_is_not_a_reply(net):
    contact = make_contact()
    row = make_row(contact.id, step=2, next_due=NOW - timedelta(minutes=1),
                   last_sent=NOW - timedelta(hours=1))
    conv = make_conv(contact.id, channel="telegram")
    db = FakeDb(
        contacts=[contact], followups=[row],
        conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=3), "Frage")],
        points=[email_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert len(out["sent"]) == 1  # pre-touch inbound did NOT stop the sequence


# --------------------------------------------------------------------------- #
# 5. LLM drafting + template fallback + language                                #
# --------------------------------------------------------------------------- #
def test_llm_success_is_used_and_subject_logged(net):
    contact = make_contact()
    db = FakeDb(contacts=[contact], points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["source"] == "llm"
    assert net.llm, "the bounded LLM seam must be used"
    ok_row = next(r for r in db.logs if r.status == "ok")
    assert ok_row.subject_preview == net.llm_result["subject"]
    assert ok_row.detail == "llm:mimo"
    # prompt carries ONLY the three allowed variables + language
    _system, user = net.llm[-1]
    for line in user.strip().splitlines():
        assert line.split(":")[0] in {"language", "first_name",
                                      "company", "interest"}


def test_llm_failure_falls_back_to_template_and_still_sends(net):
    net.llm_error = RuntimeError("provider down")
    contact = make_contact()
    db = FakeDb(contacts=[contact], points=[email_point(contact.id)])
    out = run(lf.run_due(db, NOW))
    assert len(out["sent"]) == 1, "a template send must still happen"
    assert out["sent"][0]["source"] == "template"
    assert net.email.calls, "email actually dispatched via stub"
    ok_row = next(r for r in db.logs if r.status == "ok")
    assert ok_row.detail.startswith("template")
    assert "kubotics.ch" in net.email.calls[0][2]  # step-1 template content


def test_llm_timeout_falls_back_to_template(net, monkeypatch):
    monkeypatch.setattr(lf, "LLM_TIMEOUT_S", 0.05)

    async def slow(_system, _user):
        await asyncio.sleep(1.0)
        return {}, "x", "y"

    monkeypatch.setattr(lf, "_llm_chat", slow)
    draft = run(lf.draft_touch(1, "de", first_name="Anna", company=None,
                               interest="Unitree H2"))
    assert draft.source == "template"
    assert "Vincent Verbeke" in draft.body


def test_llm_invalid_shape_falls_back_to_template(net):
    net.llm_result = {"body": "nur body, kein betreff"}
    draft = run(lf.draft_touch(1, "de", first_name="Anna", company=None,
                               interest=None))
    assert draft.source == "template"
    net.llm_result = {"subject": "x", "body": "y " * 500}  # way over the cap
    draft = run(lf.draft_touch(1, "de", first_name=None, company=None,
                               interest=None))
    assert draft.source == "template"


def test_language_en_from_inbound_message(net):
    contact = make_contact(preferred_language="de-CH")
    conv = make_conv(contact.id, channel="telegram")
    db = FakeDb(
        contacts=[contact], conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=3),
                           "Hello, we are interested in the H2 and would "
                           "like more information.")],
        points=[email_point(contact.id)],
    )
    run(lf.run_due(db, NOW))
    _system, user = net.llm[-1]
    assert "language: en" in user


def test_language_de_is_the_default(net):
    contact = make_contact()
    conv = make_conv(contact.id, channel="telegram")
    db = FakeDb(
        contacts=[contact], conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=3),
                           "Grüezi, wir sind interessiert an der H2.")],
        points=[email_point(contact.id)],
    )
    run(lf.run_due(db, NOW))
    _system, user = net.llm[-1]
    assert "language: de" in user


def test_language_en_from_preferred_language_field_without_message(net):
    contact = make_contact(preferred_language="en-US")
    db = FakeDb(contacts=[contact], points=[email_point(contact.id)])
    run(lf.run_due(db, NOW))
    _system, user = net.llm[-1]
    assert "language: en" in user


def test_optout_regex_only_matches_the_command_itself():
    assert lf.is_optout_text("STOP")
    assert lf.is_optout_text("abmelden bitte.")
    assert lf.is_optout_text("unsubscribe")
    assert not lf.is_optout_text("Stop by tomorrow for the demo!")
    assert not lf.is_optout_text("Please stop the invoice spam... wait")


# --------------------------------------------------------------------------- #
# 6. Audit log: no bodies, no recipient PII                                    #
# --------------------------------------------------------------------------- #
def test_audit_rows_carry_no_body_and_no_recipient_pii(net):
    contact = make_contact(first_name="Anna",
                           created_at=NOW - timedelta(hours=3))
    db = FakeDb(
        contacts=[contact],
        conversations=[],
        points=[email_point(contact.id, "anna.secret@example.com"),
                wa_point(contact.id, "+41790000001")],
    )
    out = run(lf.run_due(db, NOW))
    assert len(out["sent"]) == 1
    assert db.logs, "an audit row must exist"
    body_text = net.email.calls[0][2]  # what was actually sent
    for row in db.logs:
        fields = " ".join(str(getattr(row, f, "") or "")
                          for f in ("subject_preview", "detail",
                                    "provider_message_id", "channel"))
        assert "anna.secret@example.com" not in fields
        assert "+41790000001" not in fields
        assert body_text not in fields
        if row.subject_preview is not None:
            assert len(row.subject_preview) <= 200
    ok_row = next(r for r in db.logs if r.status == "ok")
    assert ok_row.channel == "email"
    assert ok_row.subject_preview  # subject preview stored for email
    # sends are counted from these ok rows for the daily cap
    assert run(lf._sends_today(db, NOW)) == 1


def test_chat_channel_logs_carry_no_subject_body(net):
    contact = make_contact()
    conv = make_conv(contact.id, channel="whatsapp")
    db = FakeDb(
        contacts=[contact], conversations=[conv],
        messages=[make_msg(conv.id, NOW - timedelta(hours=3), "Hallo")],
        points=[wa_point(contact.id)],
    )
    out = run(lf.run_due(db, NOW))
    assert out["sent"][0]["channel"] == "whatsapp"
    ok_row = next(r for r in db.logs if r.status == "ok")
    assert ok_row.subject_preview is None
    assert ok_row.provider_message_id == "wamid.test.1"
    sent_text = net.whatsapp.calls[0][1]
    assert sent_text not in (ok_row.detail or "")


# --------------------------------------------------------------------------- #
# 7. Loop: default OFF, flag ON registers                                      #
# --------------------------------------------------------------------------- #
def test_loop_default_off_registers_no_task(monkeypatch):
    monkeypatch.setattr(settings, "LEAD_FOLLOWUP_ENABLED", False)
    assert lf.followup_enabled() is False
    assert lf.maybe_start_followup_loop() is None


def test_loop_flag_on_registers_task(monkeypatch):
    monkeypatch.setattr(settings, "LEAD_FOLLOWUP_ENABLED", True)

    async def scenario():
        task = lf.maybe_start_followup_loop()
        assert task is not None
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return True

    assert run(scenario()) is True


# --------------------------------------------------------------------------- #
# 8. Admin API: auth gate, shape, no PII                                       #
# --------------------------------------------------------------------------- #
@pytest.fixture
def client():
    db = FakeDb()
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app), db
    app.dependency_overrides.pop(get_db, None)


def test_status_requires_admin_token(client):
    c, _db = client
    assert c.get("/api/v1/leads/followup/status").status_code == 401
    assert c.post("/api/v1/leads/followup/"
                  f"{uuid4()}/stop").status_code == 401


def test_status_shape_counts_and_due(client):
    c, db = client
    contacted = make_contact()
    waiting = make_row(contacted.id, step=2, next_due=NOW - timedelta(hours=1))
    done = make_row(uuid4(), status="replied", step=2, next_due=None)
    db.contacts.append(contacted)
    db.followups.extend([waiting, done])
    db.logs.append(LeadFollowupLog(
        contact_id=contacted.id, step=1, channel="email", status="ok",
        # the status endpoint counts "today" against the REAL clock (not the
        # fixed NOW fixture) — anchor to now so the test is date-independent
        created_at=datetime.now(UTC),
    ))
    res = c.get("/api/v1/leads/followup/status", headers=admin_headers())
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is False
    assert data["counts"]["pending"] == 1
    assert data["counts"]["replied"] == 1
    assert data["today_sends"] == 1
    assert data["today_cap"] == settings.LEAD_FOLLOWUP_MAX_PER_DAY
    assert [d["contact_id"] for d in data["next_due"]] == [
        str(contacted.id)]
    # no PII beyond contact_id: flat text must not contain names/addresses
    flat = res.text
    assert "Anna" not in flat and "Tester" not in flat
    assert "@" not in flat.replace(settings.API_SECRET_KEY, "")


def test_stop_endpoint_creates_terminal_row_and_audit(client):
    c, db = client
    contact = make_contact()
    db.contacts.append(contact)
    res = c.post(f"/api/v1/leads/followup/{contact.id}/stop", headers=admin_headers())
    assert res.status_code == 200
    assert res.json() == {"contact_id": str(contact.id),
                          "status": "stopped"}
    assert len(db.followups) == 1
    assert db.followups[0].status == "stopped"
    assert [r.detail for r in db.logs] == ["admin_stop"]
    # idempotent second call keeps ONE row
    res2 = c.post(f"/api/v1/leads/followup/{contact.id}/stop", headers=admin_headers())
    assert res2.status_code == 200
    assert len(db.followups) == 1


def test_stop_endpoint_404_for_unknown_contact(client):
    c, _db = client
    res = c.post(f"/api/v1/leads/followup/{uuid4()}/stop", headers=admin_headers())
    assert res.status_code == 404
