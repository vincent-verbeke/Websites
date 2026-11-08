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
