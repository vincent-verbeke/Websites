"""Tests for the cloud needle3-inbox watchdog (Vincent 2026-11-27).

Pure logic + one fake-session pass: no network, no real database.
Run: uv run pytest tests/test_needle_watchdog.py -q
"""
from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.core.config import settings          # noqa: E402
from app.models.needle import NeedleInbox     # noqa: E402
from app.services import needle_watchdog as nw  # noqa: E402

NOW = datetime(2026, 11, 27, 18, 0, 0, tzinfo=UTC)
STALE_S = settings.NEEDLE_WATCHDOG_STALE_AFTER_S
DISPATCHED_S = settings.NEEDLE_WATCHDOG_DISPATCHED_AFTER_S


def _row(status: str, age_s: int, meta: dict | None = None,
         reply_ts: datetime | None = None, text: str = "hello") -> NeedleInbox:
    return NeedleInbox(
        sender="+41797481975",
        text=text,
        status=status,
        ts=NOW - timedelta(seconds=age_s),
        meta=meta or {},
        reply_ts=reply_ts,
    )


# ---------------------------------------------------------------- evaluate ---
def test_fresh_new_row_is_not_alerted():
    stale, recover = nw.evaluate([_row("new", STALE_S - 60)], NOW, STALE_S, DISPATCHED_S)
    assert stale == [] and recover == []


def test_stale_new_row_is_alerted_once():
    row = _row("new", STALE_S + 60)
    stale, _ = nw.evaluate([row], NOW, STALE_S, DISPATCHED_S)
    assert len(stale) == 1 and stale[0][0] is row and stale[0][1] == STALE_S + 60

    row.meta = {"stale_alerted_at": NOW.isoformat()}
    stale2, _ = nw.evaluate([row], NOW, STALE_S, DISPATCHED_S)
    assert stale2 == [], "already-alerted row must not alert again"


def test_dispatched_without_reply_goes_stale():
    row = _row("dispatched", DISPATCHED_S + 30)
    stale, _ = nw.evaluate([row], NOW, STALE_S, DISPATCHED_S)
    assert len(stale) == 1


def test_dispatched_with_reply_never_alerts():
    row = _row("dispatched", DISPATCHED_S + 30, reply_ts=NOW - timedelta(seconds=5))
    stale, _ = nw.evaluate([row], NOW, STALE_S, DISPATCHED_S)
    assert stale == []


def test_recovery_only_for_alerted_undelivered_rows():
    alerted = _row("done", 3600, meta={"stale_alerted_at": "2026-11-27T17:30:00+00:00"})
    sent = _row("done", 3600, meta={
        "stale_alerted_at": "2026-11-27T17:30:00+00:00",
        "recovery_sent": "2026-11-27T17:45:00+00:00",
    })
    never_alerted = _row("done", 3600)
    stale, recover = nw.evaluate([alerted, sent, never_alerted], NOW, STALE_S, DISPATCHED_S)
    assert stale == []
    assert recover == [alerted]


def test_new_row_without_meta_dict_is_tolerated():
    row = _row("new", STALE_S + 60, meta=None)
    row.meta = None  # type: ignore[assignment]
    stale, _ = nw.evaluate([row], NOW, STALE_S, DISPATCHED_S)
    assert len(stale) == 1


# ------------------------------------------------------------------- texts ---
def test_alert_text_carries_count_age_and_snippet():
    t = nw.alert_text(2, 600, "Pls review my whatsapp")
    assert "2 WhatsApp messages" in t
    assert "10 min" in t
    assert "Pls review my whatsapp" in t
    assert "queued" in t.lower()


def test_recovery_text_counts():
    assert "1 queued message" in nw.recovery_text(1)
    assert "3 queued messages" in nw.recovery_text(3)


# --------------------------------------------------------------- gating -----
def test_maybe_start_respects_enabled_flag(monkeypatch):
    async def drive():
        monkeypatch.setattr(settings, "NEEDLE_WATCHDOG_ENABLED", False)
        assert nw.maybe_start_needle_watchdog_loop() is None

        monkeypatch.setattr(settings, "NEEDLE_WATCHDOG_ENABLED", True)
        task = nw.maybe_start_needle_watchdog_loop()
        assert isinstance(task, asyncio.Task)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(drive())


# ------------------------------------------------------------ check_once -----
class _R:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    """First execute() = inbox rows query; later ones = empty (no dup events)."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = 0
        self.added = []
        self.commits = 0

    async def execute(self, _q):
        self.calls += 1
        return _R(self.rows if self.calls == 1 else [])

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


def _run(coro):
    return asyncio.run(coro)


def test_check_once_alerts_and_stamps(monkeypatch):
    sent: list[str] = []

    async def fake_send(text: str) -> bool:
        sent.append(text)
        return True

    monkeypatch.setattr(nw, "_send", fake_send)
    row = _row("new", STALE_S + 120, text="why no reply")
    session = FakeSession([row])
    out = _run(nw.check_once(session, now=NOW))
    assert out["alerted"] == 1 and out["recovered"] == 0
    assert len(sent) == 1 and "why no reply" in sent[0]
    assert row.meta.get("stale_alerted_at") == NOW.isoformat()
    assert session.commits == 1
    assert any(getattr(e, "channel", None) == "needle_watch" for e in session.added)


def test_check_once_send_failure_does_not_stamp(monkeypatch):
    async def fake_send(_text: str) -> bool:
        return False

    monkeypatch.setattr(nw, "_send", fake_send)
    row = _row("new", STALE_S + 120)
    session = FakeSession([row])
    out = _run(nw.check_once(session, now=NOW))
    assert out["alerted"] == 0
    assert not row.meta.get("stale_alerted_at"), "failed alert must retry next tick"


def test_check_once_recovery_batch(monkeypatch):
    sent: list[str] = []

    async def fake_send(text: str) -> bool:
        sent.append(text)
        return True

    monkeypatch.setattr(nw, "_send", fake_send)
    r1 = _row("done", 3600, meta={"stale_alerted_at": "2026-11-27T17:30:00+00:00"})
    r2 = _row("failed", 3600, meta={"stale_alerted_at": "2026-11-27T17:31:00+00:00"})
    session = FakeSession([r1, r2])
    out = _run(nw.check_once(session, now=NOW))
    assert out["recovered"] == 2 and len(sent) == 1
    assert "2 queued messages" in sent[0]
    assert r1.meta.get("recovery_sent") == NOW.isoformat()
    assert r2.meta.get("recovery_sent") == NOW.isoformat()


def test_check_once_healthy_inbox_is_quiet(monkeypatch):
    async def fake_send(_text: str) -> bool:
        raise AssertionError("no send expected on a healthy inbox")

    monkeypatch.setattr(nw, "_send", fake_send)
    session = FakeSession([
        _row("new", 30),
        _row("done", 600, meta={}),
        _row("done", 900, meta={"recovery_sent": "x"}),  # alerted? no -> ignored
    ])
    out = _run(nw.check_once(session, now=NOW))
    assert out == {"alerted": 0, "recovered": 0, "scanned": 3}
    assert session.commits == 1
