"""Unit tests for the cloud trading watcher (pure logic — no network, no DB).

Run:  uv run pytest tests/test_trading_watch.py -q
Docs: docs/TRADING_WATCH_CLOUD.md
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.core.config import settings          # noqa: E402
from app.services import trading_watch as tw  # noqa: E402


def _perp(sym: str, amt: float, px: float) -> dict:
    return {"symbol": sym, "positionAmt": str(amt), "entryPrice": str(px)}


def _healthy_book() -> tuple[list[dict], dict[str, float], dict[str, float]]:
    perps = [
        _perp("CHRUSDT", -2512, 0.09), _perp("DYDXUSDT", -406.1, 1.1),
        _perp("PEOPLEUSDT", -6495, 0.02), _perp("SFPUSDT", -195, 0.3),
        _perp("UNIUSDC", -6, 6.5),
        _perp("QUSDT", 97, 0.128), _perp("AGTUSDT", 136, 0.09),
        _perp("BTWUSDT", 6, 1.9), _perp("BULLAUSDT", 176, 0.07),
        _perp("AKEUSDT", 416, 0.03), _perp("JCTUSDT", 1933, 0.0064),
        _perp("INITUSDT", 80, 0.155), _perp("MUBARAKUSDT", 236, 0.053),
    ]
    spot = {"CHR": 2509.5, "DYDX": 405.7, "PEOPLE": 6289.7,
            "SFP": 194.8, "UNI": 5.99}
    rates = {p["symbol"]: 0.0001 for p in perps}
    return perps, spot, rates


EXPECTED = settings.TRADING_WATCH_EXPECTED_PERP.split(",")


def test_healthy_book_is_clean():
    perps, spot, rates = _healthy_book()
    assert tw.evaluate(perps, spot, rates, expected=EXPECTED) == []


def test_missing_carry_perp_leg_alerts():
    perps, spot, rates = _healthy_book()
    perps = [p for p in perps if p["symbol"] != "SFPUSDT"]
    out = tw.evaluate(perps, spot, rates, expected=EXPECTED)
    assert any("SFPUSDT" in p and "GONE" in p for p in out)


def test_hedge_mismatch_above_5pct_alerts():
    perps, spot, rates = _healthy_book()
    spot["CHR"] = 2000.0
    out = tw.evaluate(perps, spot, rates, expected=EXPECTED)
    assert any("CHRUSDT" in p and "mismatch" in p for p in out)


def test_negative_funding_regime_alerts_sign_correctly():
    """Regression for the sign bug fixed 2026-11-01: shorts RECEIVE when
    rates>0; they PAY when rates<0, so negative rates must trip the alert."""
    perps, spot, rates = _healthy_book()
    rates = {k: -0.001 for k in rates}
    out = tw.evaluate(perps, spot, rates, expected=EXPECTED)
    assert any("funding" in p and "PAYING" in p for p in out), out


def test_positive_hot_funding_does_not_alert():
    perps, spot, rates = _healthy_book()
    rates = {k: 0.0005 for k in rates}   # hot receiving regime
    out = tw.evaluate(perps, spot, rates, expected=EXPECTED)
    assert not any("funding" in p for p in out), out


def test_position_drift_alerts_both_ways():
    perps, spot, rates = _healthy_book()
    out = tw.evaluate(perps + [_perp("HACKEDUSDT", 100, 1.0)], spot,
                      rates, expected=EXPECTED)
    assert any("NEW perp" in p and "HACKEDUSDT" in p for p in out)
    shrunk = [p for p in perps if p["symbol"] != "QUSDT"]
    out = tw.evaluate(shrunk, spot, rates, expected=EXPECTED)
    assert any("CLOSED perp" in p and "QUSDT" in p for p in out), out


def test_event_id_stable_per_minute_and_distinct_for_different_problems():
    a = tw.make_event_id(["p1", "p2"])
    b = tw.make_event_id(["p2", "p1"])       # order-independent
    c = tw.make_event_id(["different"])
    assert a == b
    assert a != c
    assert a.startswith("trading-alert-") and len(a.rsplit("-", 1)[-1]) == 8


def test_signed_qs_shape_never_contains_secret():
    settings.BINANCE_API_KEY, settings.BINANCE_API_SECRET = "TESTKEY", "TOPSECRET"
    try:
        qs, hdr = tw._signed_qs({"limit": 1})
        assert "limit=1" in qs and "signature=" in qs and "timestamp=" in qs
        assert "TOPSECRET" not in qs and "TOPSECRET" not in str(hdr)
        assert hdr["X-MBX-APIKEY"] == "TESTKEY"
        sig = qs.rsplit("signature=", 1)[1]
        assert len(sig) == 64 and all(c in "0123456789abcdef" for c in sig)
    finally:
        settings.BINANCE_API_KEY = settings.BINANCE_API_SECRET = ""


def test_sms_disabled_by_default_without_boto3():
    assert settings.TRADING_WATCH_SMS_ENABLED is False
    assert tw._send_sms("any text") == "disabled"
