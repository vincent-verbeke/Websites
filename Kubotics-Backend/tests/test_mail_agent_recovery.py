"""Regression tests for the send-path guards and outage self-heal (mail agent).

Run:  uv run pytest tests/test_mail_agent_recovery.py -q

Scope honesty: the SQL *selection* of the self-heal (which failure patterns /
age qualify for requeue) is intentionally NOT re-tested here — it was verified
against the real production DB in the controlled 12:0x smokes (2 rows healed:
classify-LLMUnavailable + transient detail_fetch; 3 guards held:
compose_validation, 404, too-young; recorded in plan §7/t24). These tests pin
the *control flow and mutations* that future edits (Phase D dashboard work,
ledger changes) could silently break:

  * requeue mutation: state -> received, error cleared, llm/detail attempts
    reset (a broken reset would hot-loop or permanently park rows);
  * empty-reply (observe) guard: never reaches Graph — an empty ``comment``
    would send a blank mail to a real person;
  * Phase-B gate re-check at send time: restricted sender -> ignored_unknown;
  * 24h conversation cooldown: holds without touching Graph;
  * daily cap (Q6): all ready rows -> needs_review/cap_reached, zero sends,
    no notice outside the Q11 window;
  * Q11 alert flush: sends + marks inside the window, queues outside it.

Second block: the process_pending pipeline itself (the function that runs
every 60s in production) with all network/LLM seams stubbed — happy path,
classify outage defer/park ladder, header hard-filter before the LLM,
Phase-B gate before any network, compose validation terminality, observe
mode, and inbound_events emission (plan node O).

Every send_ready test stubs BOTH outbound surfaces (resolve_graph_id = Graph
POST, whatsapp_service = needle) so a regression that reopens a send path
fails the test instead of messaging a real human.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.core.config import settings
from app.models.mail_agent import MailMessage
from app.services import mail_agent as ma

# --- fakes -------------------------------------------------------------------

class _Res:
    """Mimics the ScalarResult surface send_ready / requeue use."""

    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return self

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None

    def scalar_one(self):
        if len(self._items) != 1:
            raise AssertionError(f"scalar_one expected exactly 1 item, got {len(self._items)}")
        return self._items[0]

    def scalar(self):
        return self._items[0] if self._items else None


class _FakeDb:
    """AsyncSession stand-in returning canned results in call order.

    An unexpected extra ``execute`` raises IndexError — intentionally, so
    flow drift in send_ready fails loudly instead of passing vacuously.
    """

    def __init__(self, responses):
        self._responses = list(responses)
        self.commits = 0

    async def execute(self, *_args, **_kwargs):
        if not self._responses:
            raise AssertionError("send_ready issued more db.execute calls than the test provided")
        return _Res(self._responses.pop(0))

    async def commit(self):
        self.commits += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeWhatsApp:
    """Stands in for whatsapp_service; records calls, never hits the network."""

    def __init__(self, ok=True):
        self.ok = ok
        self.calls: list[tuple] = []

    async def send_text_message(self, to, text):
        self.calls.append((to, text))
        return self.ok, "", ""


class _GraphSpy:
    """resolve_graph_id stand-in — records; default: pretend the message is gone."""

    def __init__(self, graph_id=None):
        self.graph_id = graph_id
        self.calls: list[str] = []

    async def __call__(self, internet_message_id):
        self.calls.append(internet_message_id)
        return self.graph_id


def _run(coro):
    return asyncio.run(coro)


def _row(**kw) -> MailMessage:
    defaults = {
        "internet_message_id": f"<msg-{id(kw)}@test>",
        "sender": "liz.mallet@kuroliv.ch",
        "subject": "test",
        "received_at": datetime.now(UTC),
        "state": "classified",
        "classification": {},
    }
    defaults.update(kw)
    return MailMessage(**defaults)


# --- outage self-heal (mutation half) ---------------------------------------

def test_requeue_resets_parked_llm_failures():
    """Infrastructure-fault rows must come back fully reset (plan §7.4)."""
    row = _row(
        state="needs_review",
        error="classify:LLMUnavailable: all providers failed",
        classification={"llm_attempts": 5, "detail_attempts": 2, "category": "informational"},
    )
    fresh = _row(state="needs_review", error="detail_fetch:timeout: read timed out",
                 classification={"detail_attempts": 3})
    db = _FakeDb([[row, fresh]])
    stats = {"requeued": 0}

    n = _run(ma._requeue_parked_llm_failures(db, stats))

    assert n == 2 and stats["requeued"] == 2
    for r in (row, fresh):
        assert r.state == "received"
        assert r.error is None
    assert row.classification["llm_attempts"] == 0
    assert "detail_attempts" not in row.classification
    assert "detail_attempts" not in fresh.classification
    # classification payload (audit) is preserved, only attempt counters reset
    assert row.classification.get("category") == "informational"


def test_requeue_empty_selection_is_noop():
    db = _FakeDb([[]])
    stats = {"requeued": 0}
    assert _run(ma._requeue_parked_llm_failures(db, stats)) == 0
    assert stats["requeued"] == 0


# --- send_ready guards -------------------------------------------------------

def test_send_ready_empty_reply_never_reaches_graph(monkeypatch):
    """Observe-mode / empty compose must not POST (blank-mail regression)."""
    row = _row(reply_text="   ")
    graph = _GraphSpy()
    wa = _FakeWhatsApp()
    monkeypatch.setattr(ma, "resolve_graph_id", graph)
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal", lambda: _FakeDb([[], [row], [0], []]))

    stats = _run(ma.send_ready())

    assert stats["observe_skip"] == 1 and stats["sent"] == 0
    assert graph.calls == [], "resolve_graph_id must not run for an empty reply"
    assert wa.calls == []
    assert row.state == "classified"  # unchanged -> visible for review/observers


def test_send_ready_phase_b_gate_recheck_at_send_time(monkeypatch):
    """A restricted sender must flip to ignored_unknown even if classified."""
    row = _row(sender="stranger@example.com", reply_text="<p>hi</p>")
    graph = _GraphSpy()
    wa = _FakeWhatsApp()
    monkeypatch.setattr(settings, "MAIL_AGENT_ONLY_SENDERS", "liz.mallet@kuroliv.ch")
    monkeypatch.setattr(ma, "resolve_graph_id", graph)
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal", lambda: _FakeDb([[], [row], [0], []]))

    stats = _run(ma.send_ready())

    assert row.state == "ignored_unknown"
    assert row.summary == "restricted:phase_b_only_senders"
    assert graph.calls == [] and wa.calls == []
    assert stats["sent"] == 0


def test_send_ready_cooldown_holds_second_reply(monkeypatch):
    """Plan §3.4: one reply per conversation per 24h — hold, do not fail."""
    row = _row(reply_text="<p>hello</p>", conversation_id="conv-shared")
    prior = _row(conversation_id="conv-shared",
                 sent_at=datetime.now(UTC).replace(microsecond=0),
                 state="replied")
    graph = _GraphSpy()
    wa = _FakeWhatsApp()
    monkeypatch.setattr(ma, "resolve_graph_id", graph)
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    # order: sent_today, ready, [cooldown prior], capped-count, pending alerts
    monkeypatch.setattr(ma, "AsyncSessionLocal",
                        lambda: _FakeDb([[], [row], [prior], [0], []]))

    stats = _run(ma.send_ready())

    assert stats["cooldown_skip"] == 1 and stats["sent"] == 0
    assert graph.calls == [] and wa.calls == []
    assert row.state == "classified"  # stays queued for after the cooldown


def test_send_ready_cap_blocks_all_ready_without_sending(monkeypatch):
    """Q6: cap hit -> every ready row needs_review/cap_reached, zero sends,
    and NO cap notice outside the Q11 window (queued until it opens)."""
    sent = [_row(state="replied", sent_at=datetime.now(UTC)) for _ in range(2)]
    ready = _row(reply_text="<p>answer</p>")
    graph = _GraphSpy()
    wa = _FakeWhatsApp()
    monkeypatch.setattr(settings, "MAIL_AGENT_MAX_REPLIES_PER_DAY", 2)
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_START", "23:00")
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_END", "23:30")
    monkeypatch.setattr(ma, "resolve_graph_id", graph)
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal",
                        lambda: _FakeDb([sent, [ready], [1], []]))

    stats = _run(ma.send_ready())

    assert stats["cap_blocked"] == 1 and stats["sent"] == 0
    assert ready.state == "needs_review"
    assert ready.summary == "cap_reached:limit_2"
    assert graph.calls == [] and wa.calls == []
    assert stats["cap_notice"] == 0  # outside window -> notice deferred (Q11)


# --- Q11 alert flush ---------------------------------------------------------

def test_alert_flush_sends_inside_window_and_marks(monkeypatch):
    row = _row(state="classified", whatsapp_notified_at=None, priority="P1",
               classification={"notify": True, "priority": "P1", "tier": "board",
                               "category": "critical", "summary": "urgent deadline"},
               web_link="https://outlook.office.com/mail/x")
    wa = _FakeWhatsApp(ok=True)
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_START", "00:00")
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_END", "23:59")
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal",
                        lambda: _FakeDb([[], [], [0], [row]]))

    stats = _run(ma.send_ready())

    assert stats["alerts_sent"] == 1 and stats["alerts_pending"] == 0
    assert len(wa.calls) == 1
    assert wa.calls[0][0] == settings.MAIL_AGENT_NOTIFY_PHONE
    assert "P1" in wa.calls[0][1] and "urgent deadline" in wa.calls[0][1]
    assert row.whatsapp_notified_at is not None


def test_alert_flush_queues_outside_window(monkeypatch):
    """Q11: alerts outside 07:30-22:00 stay pending (no send, no mark)."""
    row = _row(state="classified", whatsapp_notified_at=None,
               classification={"notify": True, "priority": "P1"})
    wa = _FakeWhatsApp(ok=True)
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_START", "23:00")
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_END", "23:30")
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal",
                        lambda: _FakeDb([[], [], [0], [row]]))

    stats = _run(ma.send_ready())

    assert stats["alerts_pending"] == 1 and stats["alerts_sent"] == 0
    assert wa.calls == []
    assert row.whatsapp_notified_at is None


def test_alert_flush_failed_send_stays_pending_for_retry(monkeypatch):
    """WhatsApp delivery failure must NOT mark the alert — retried next cycle."""
    row = _row(state="classified", whatsapp_notified_at=None,
               classification={"notify": True, "priority": "P1"})
    wa = _FakeWhatsApp(ok=False)
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_START", "00:00")
    monkeypatch.setattr(settings, "MAIL_AGENT_ALERT_WINDOW_END", "23:59")
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal",
                        lambda: _FakeDb([[], [], [0], [row]]))

    stats = _run(ma.send_ready())

    assert stats["alerts_sent"] == 0 and stats["alerts_pending"] == 1
    assert len(wa.calls) == 1            # attempt happened
    assert row.whatsapp_notified_at is None  # but not recorded as delivered


# --- Graph POST semantics (marker-before-send, success/failure handling) -----

class _FakeResp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class _FakeHttpClient:
    """Stands in for httpx.AsyncClient inside send_ready's POST block."""

    def __init__(self, behavior):
        self.behavior = behavior      # int status | Exception instance
        self.posts: list[dict] = []
        self.on_post = None           # callable run at post time (ordering asserts)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None, timeout=None):
        if self.on_post:
            self.on_post()
        if isinstance(self.behavior, Exception):
            raise self.behavior
        self.posts.append({"url": url, "json": json,
                           "bearer": (headers or {}).get("Authorization")})
        return _FakeResp(self.behavior, "" if self.behavior < 400 else "forbidden")


def _stub_send(monkeypatch, row, *, graph_id="GRAPH-ID-1", behavior=202):
    """Common send_ready setup: canned db, Graph resolve, token, POST client."""
    fake_db = _FakeDb([[], [row], [0], []])   # sent_today, ready, capped, flush
    graph = _GraphSpy(graph_id)
    client = _FakeHttpClient(behavior)
    wa = _FakeWhatsApp()
    monkeypatch.setattr(settings, "MAIL_AGENT_ONLY_SENDERS", "")
    monkeypatch.setattr(ma, "resolve_graph_id", graph)
    monkeypatch.setattr(ma, "whatsapp_service", wa)
    monkeypatch.setattr(ma, "AsyncSessionLocal", lambda: fake_db)
    monkeypatch.setattr(ma.m365_service, "get_access_token", lambda: "test-token")
    monkeypatch.setattr(ma.httpx, "AsyncClient", lambda: client)
    return fake_db, graph, client, wa


def test_send_post_success_marks_replied_after_durable_marker(monkeypatch):
    """202 -> replied; the send_attempted_at marker is committed BEFORE the POST
    (PC-A unconfirmed semantics: a crash mid-POST must never auto-retry)."""
    row = _row(state="classified", reply_text="<p>Answer</p>")
    fake_db, _graph, client, wa = _stub_send(monkeypatch, row)

    def _assert_marker_durable():
        assert row.graph_message_id == "GRAPH-ID-1"
        assert row.send_attempted_at is not None
        assert fake_db.commits >= 1, "marker must be persisted before the POST"

    client.on_post = _assert_marker_durable

    stats = _run(ma.send_ready())

    assert stats["sent"] == 1 and stats["failed"] == 0
    assert row.state == "replied" and row.sent_at is not None
    assert row.error is None
    assert len(client.posts) == 1
    post = client.posts[0]
    assert post["url"].endswith("/messages/GRAPH-ID-1/reply")
    assert post["bearer"] == "Bearer test-token"
    assert post["json"]["comment"] == "<p>Answer</p>"
    assert wa.calls == []


def test_send_post_http_error_marks_send_failed(monkeypatch):
    """Non-2xx reply -> send_failed with the Graph error captured (no retry)."""
    row = _row(state="classified", reply_text="<p>Answer</p>")
    _fake_db, _graph, _client, _wa = _stub_send(monkeypatch, row, behavior=403)

    stats = _run(ma.send_ready())

    assert stats["failed"] == 1 and stats["sent"] == 0
    assert row.state == "send_failed"
    assert row.error.startswith("reply HTTP 403")
    assert row.sent_at is None


def test_send_post_transport_error_is_unconfirmed_never_retryable(monkeypatch):
    """Network drop mid-POST: send_failed + post_unconfirmed (reply MAY have
    gone out — a silent retry could double-reply a real person)."""
    row = _row(state="classified", reply_text="<p>Answer</p>")
    _, _, client, _ = _stub_send(
        monkeypatch, row, behavior=ma.httpx.ConnectError("connection reset"))

    stats = _run(ma.send_ready())

    assert stats["failed"] == 1
    assert row.state == "send_failed"
    assert row.error.startswith("post_unconfirmed:ConnectError")
    assert "MAY have been sent" in row.error
    assert len(client.posts) == 0        # the fake raised before recording


def test_send_resolve_failure_never_constructs_post(monkeypatch):
    """Message gone from mailbox -> send_failed BEFORE any network client."""
    row = _row(state="classified", reply_text="<p>Answer</p>")
    fake_db, graph, client, _ = _stub_send(monkeypatch, row, graph_id=None)

    stats = _run(ma.send_ready())

    assert stats["failed"] == 1
    assert row.state == "send_failed"
    assert row.error.startswith("resolve:graph_id_not_found")
    assert row.graph_message_id is None and row.send_attempted_at is None
    assert graph.calls and client.posts == []
    assert fake_db.commits == 1         # only the state commit, no marker needed


# --- process_pending pipeline (all network/LLM seams stubbed) ----------------

_CLS_OK = ({"language": "en", "category": "informational", "criticality": "normal",
            "spam_probability": 0.1, "summary": "informational mail",
            "personal_email": True},
           "mimo", "mimo-v2.6-flash")
_COMPOSE_OK = ("<p>Thanks Liz — Kubot here.</p>", "mimo", "mimo-v2.6-flash")
_OVERRIDES = {"liz.mallet@kuroliv.ch": {"tier": "contact", "note": "partner",
                                        "display_name": "Liz"}}
_DETAIL_OK = {"internetMessageHeaders": [],
              "body": {"content": "<p>Hello there</p>"},
              "toRecipients": [{"emailAddress": {"address": "vincent@kubotics.ch"}}],
              "ccRecipients": []}


def _stub_pipeline(monkeypatch, row, *, detail=_DETAIL_OK, classify=_CLS_OK,
                   compose=_COMPOSE_OK, only="", mode="auto"):
    """Stub every network/LLM seam of process_pending; return call recorder."""
    calls = {"detail": [], "classify": [], "compose": [], "event": []}

    async def _detail_fn(_client, mid):
        calls["detail"].append(mid)
        if isinstance(detail, Exception):
            raise detail
        return detail

    async def _thread_fn(*_a, **_k):
        return False

    async def _contacts_fn(_client):
        return []

    async def _overrides_fn():
        return dict(_OVERRIDES)

    async def _event_fn(_db, _row):
        calls["event"].append(_row.internet_message_id)

    async def _classify_fn(**kwargs):
        calls["classify"].append(kwargs)
        if isinstance(classify, Exception):
            raise classify
        return classify

    async def _compose_fn(**kwargs):
        calls["compose"].append(kwargs)
        if isinstance(compose, Exception):
            raise compose
        return compose

    monkeypatch.setattr(settings, "MAIL_AGENT_ONLY_SENDERS", only)
    monkeypatch.setattr(settings, "MAIL_AGENT_MODE", mode)
    monkeypatch.setattr(ma, "fetch_message_detail", _detail_fn)
    monkeypatch.setattr(ma, "thread_within_window", _thread_fn)
    monkeypatch.setattr(ma, "fetch_contacts", _contacts_fn)
    monkeypatch.setattr(ma, "load_overrides", _overrides_fn)
    monkeypatch.setattr(ma, "record_classification_event", _event_fn)
    monkeypatch.setattr(ma.mail_llm, "classify_message", _classify_fn)
    monkeypatch.setattr(ma.mail_llm, "compose_reply", _compose_fn)
    monkeypatch.setattr(ma, "AsyncSessionLocal",
                        lambda: _FakeDb([[], [row]]))  # requeue-select, rows-select
    return calls


def test_process_pending_happy_path_classifies_composes_and_emits_event(monkeypatch):
    """received -> detail -> route(contact) -> classify -> decide -> compose
    -> classified, with inbound_events emitted (plan node O)."""
    row = _row(state="received")
    calls = _stub_pipeline(monkeypatch, row)

    stats = _run(ma.process_pending())

    assert stats["taken"] == 1 and stats["ready"] == 1
    assert row.state == "classified"
    assert row.reply_text == _COMPOSE_OK[0]
    assert row.route == "contact" and row.tier == "contact"
    assert row.llm_provider == "mimo" and row.llm_model == "mimo-v2.6-flash"
    cls = row.classification
    assert cls["priority"] == "P4" and cls["notify"] is False
    assert cls["rcpt_count"] == 1 and cls["provider"] == "mimo"
    assert calls["classify"] and calls["classify"][0]["route"] == "contact"
    assert calls["classify"][0]["tier"] == "contact"
    assert len(calls["compose"]) == 1
    assert calls["event"] == [row.internet_message_id], "node O event missing"


def test_process_pending_classify_outage_defers_then_retries(monkeypatch):
    """LLMUnavailable on classify: stays received (self-heal compatible)."""
    row = _row(state="received")
    calls = _stub_pipeline(monkeypatch, row,
                           classify=ma.mail_llm.LLMUnavailable("all providers down"))

    stats = _run(ma.process_pending())

    assert stats["deferred"] == 1 and stats["review"] == 0
    assert row.state == "received"          # NOT parked — retried next cycle
    assert row.error.startswith("classify:LLMUnavailable")
    assert row.classification["llm_attempts"] == 1
    assert calls["compose"] == [] and calls["event"] == []


def test_process_pending_classify_outage_parks_at_attempt_five(monkeypatch):
    """A persistently failing chain stops at 5 attempts -> needs_review."""
    row = _row(state="received", classification={"llm_attempts": 4})
    _stub_pipeline(monkeypatch, row,
                   classify=ma.mail_llm.LLMUnavailable("all providers down"))

    stats = _run(ma.process_pending())

    assert stats["review"] == 1 and stats["deferred"] == 0
    assert row.state == "needs_review"
    assert row.error.startswith("classify:LLMUnavailable")
    assert row.classification["llm_attempts"] == 5


def test_process_pending_header_hard_filter_blocks_before_llm(monkeypatch):
    """List-Unsubscribe mail dies at the header gate — no LLM cost, no event."""
    detail = {**_DETAIL_OK,
              "internetMessageHeaders": [{"name": "List-Unsubscribe",
                                          "value": "<mailto:a@b.c>"}]}
    row = _row(state="received")
    calls = _stub_pipeline(monkeypatch, row, detail=detail)

    stats = _run(ma.process_pending())

    assert stats["ignored"] == 1 and stats["taken"] == 1
    assert row.state == "ignored_spam"
    assert row.summary.startswith("hard_filter:")
    assert calls["classify"] == [], "hard-filtered mail must never reach the LLM"
    assert calls["event"] == []


def test_process_pending_phase_b_gate_blocks_before_any_network(monkeypatch):
    """Restricted sender: flip + stop BEFORE detail fetch (§8, no Graph/LLM)."""
    row = _row(state="received", sender="stranger@example.com")
    calls = _stub_pipeline(monkeypatch, row, only="liz.mallet@kuroliv.ch")

    stats = _run(ma.process_pending())

    assert stats["restricted"] == 1
    assert row.state == "ignored_unknown"
    assert row.summary == "restricted:phase_b_only_senders"
    assert calls["detail"] == [] and calls["classify"] == [] and calls["compose"] == []


def test_process_pending_compose_validation_failure_is_terminal(monkeypatch):
    """Plan §5: invalid compose -> needs_review (never a silent retry loop)."""
    row = _row(state="received")
    _stub_pipeline(monkeypatch, row, compose=ma.mail_llm.ReplyInvalid("body too short"))

    stats = _run(ma.process_pending())

    assert stats["review"] == 1
    assert row.state == "needs_review"
    assert row.error.startswith("compose_validation:")
    assert row.reply_text is None


def test_process_pending_observe_mode_classifies_without_compose(monkeypatch):
    """§3.3 observe: classified state, no compose — send_ready's empty-reply
    guard is the second line of defence."""
    row = _row(state="received")
    calls = _stub_pipeline(monkeypatch, row, mode="observe")

    stats = _run(ma.process_pending())

    assert stats["ready"] == 1
    assert row.state == "classified"
    assert row.reply_text is None
    assert calls["classify"] and calls["compose"] == []
    assert row.category == "informational"  # classify still ran (node O fires)


# --- cross-module contract: decide() kinds vs compose REPLY_RULES ------------

def test_graph_message_id_column_fits_real_graph_ids():
    """Schema pin: the live send attempt (2026-11-08 14:35) proved Graph
    message ids exceed 128 chars — the marker UPDATE crashed the whole cycle
    BEFORE the POST, deadlocking the loop. Keep the column wide."""
    col = MailMessage.__table__.c.graph_message_id
    assert col.type.length is not None and col.type.length >= 256, (
        f"graph_message_id width {col.type.length} — real ids are >128 chars; "
        f"widening requires an ALTER on live tables too")


def test_decide_reply_kinds_all_have_compose_rules():
    """contract: every kind decide() can emit for action=reply must exist in
    mail_llm.REPLY_RULES — otherwise compose_reply raises ReplyInvalid and the
    row dies as compose_validation on EVERY send (T1 total failure). Catches:
    a new decide kind without a prompt rule, and orphaned prompt rules."""
    kinds: set[str] = set()
    tiers = ("board", "vip_customer", "customer", "partner", "lead", "test",
             "contact", "unknown")
    for category in sorted(ma.mail_llm.VALID_CATEGORIES):
        for criticality in ("low", "normal", "high", "critical"):
            for tier in tiers:
                action = ma.decide(
                    category=category, criticality=criticality, tier=tier,
                    spam_probability=0.1, personal_email=True,
                    route="thread_reply" if tier == "unknown" else "contact",
                    unknown_policy="auto", spam_threshold=0.80)
                if action["action"] == "reply":
                    assert action["kind"] in ma.mail_llm.REPLY_RULES, (
                        f"decide() kind {action['kind']!r} (category={category}, "
                        f"tier={tier}) has no compose rule — would ReplyInvalid "
                        f"at send time")
                    kinds.add(action["kind"])
    # vocabulary pinned BOTH ways: no silent additions/removals on either side
    assert kinds == {"thank_you", "holding", "ack_only"}
    assert set(ma.mail_llm.REPLY_RULES) == {"thank_you", "holding", "ack_only"}
