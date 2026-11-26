"""Unit tests for B2/B4/B5 logic (docs §16–§19): attribution mapping,
metric normalization, spend-cap/approval decisions. Pure — no network/DB."""

import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.api.v1.marketing_guard import (
    month_start_utc,
    normalize_metric,
    spend_decision,
)
from app.core.config import settings
from app.services.lead_service import (
    apply_attribution,
    apply_lead_form_consent,
)

# ------------------------------- B2: attribution ---------------------------

def _payload(**kw):
    base = {"utm_source": None, "utm_medium": None, "utm_campaign": None,
            "utm_content": None, "utm_term": None, "gclid": None,
            "referrer_url": None}
    base.update(kw)
    return SimpleNamespace(**base)


def _contact(**kw):
    base = {"utm_source": None, "utm_medium": None, "utm_campaign": None,
            "utm_content": None, "utm_term": None, "gclid": None,
            "referrer_url": None, "first_touch_at": None, "last_touch_at": None,
            "consent_status": "unknown", "consent_source": None,
            "consent_at": None}
    base.update(kw)
    return SimpleNamespace(**base)


def test_attribution_sets_fields_and_touches():
    c = _contact()
    t1 = datetime(2026, 11, 2, 8, 0, tzinfo=UTC)
    apply_attribution(c, _payload(utm_source="google", utm_campaign="h2-test",
                                  gclid="GCLID123",
                                  referrer_url="https://x/y"), now=t1)
    assert c.utm_source == "google" and c.utm_campaign == "h2-test"
    assert c.gclid == "GCLID123" and c.referrer_url == "https://x/y"
    assert c.first_touch_at == t1 and c.last_touch_at == t1


def test_attribution_last_touch_semantics():
    c = _contact()
    t1 = datetime(2026, 11, 2, 8, 0, tzinfo=UTC)
    t2 = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
    apply_attribution(c, _payload(utm_source="google"), now=t1)
    apply_attribution(c, _payload(utm_source="linkedin", utm_term="robot"), now=t2)
    assert c.utm_source == "linkedin"          # last touch wins
    assert c.first_touch_at == t1              # first preserved
    assert c.last_touch_at == t2
    # no attribution at all -> no touch stamps
    c2 = _contact()
    apply_attribution(c2, _payload(), now=t1)
    assert c2.first_touch_at is None and c2.last_touch_at is None


def test_lead_form_consent_sets_once_and_never_downgrades():
    c = _contact()
    apply_lead_form_consent(c, now=datetime(2026, 11, 2, tzinfo=UTC))
    assert c.consent_status == "lead_form"
    assert c.consent_source == "website_form" and c.consent_at is not None
    c.granted = None
    c2 = _contact(consent_status="denied", consent_source="manual")
    apply_lead_form_consent(c2)
    assert c2.consent_status == "denied" and c2.consent_source == "manual"


# ------------------------------- B4: metrics -------------------------------

def test_normalize_metric_valid_and_defaults():
    m = normalize_metric({"campaign": "H2 Launch", "channel": "GOOGLE",
                          "day": "2026-11-02", "spend_chf": "12.50",
                          "clicks": 7})
    assert m["campaign"] == "H2 Launch" and m["channel"] == "google"
    assert m["day"] == datetime(2026, 11, 2, tzinfo=UTC)
    assert m["spend_chf"] == 12.5 and m["clicks"] == 7
    assert m["leads"] == 0 and m["extra"] == {}
    m2 = normalize_metric({"campaign": "x", "channel": "meta",
                           "day": "2026-11-02T10:00:00+01:00"})
    assert m2["day"].hour in (9, 10)           # tz preserved


def test_normalize_metric_rejects_bad_payloads():
    for bad in ({}, {"campaign": "x"}, {"campaign": "x", "channel": "meta"},
                {"campaign": "x", "channel": "meta", "day": "not-a-date"},
                {"campaign": "x", "channel": "meta", "day": "2026-11-02",
                 "spend_chf": -1},
                {"campaign": "x", "channel": "meta", "day": "2026-11-02",
                 "clicks": -5}):
        try:
            normalize_metric(bad)
            raise AssertionError(f"should have rejected {bad}")
        except ValueError:
            pass


# ------------------------------- B5: spend gate ----------------------------

def test_spend_requires_approval_first():
    ok, why = spend_decision(10, "meta", 0, 0, approved=False)
    assert not ok and "approval required" in why
    ok, why = spend_decision(0, "meta", 0, 0, approved=True)
    assert not ok and "> 0" in why


def test_spend_within_caps_allowed():
    ok, why = spend_decision(50, "meta", 10, 0, approved=True)
    assert ok and why == "allowed"


def test_spend_total_cap_blocks():
    ok, why = spend_decision(45, "meta", 65, 0, approved=True)   # 110 > 105
    assert not ok and "total cap" in why and "remaining 40" in why


def test_spend_search_subcap_blocks_google_only():
    ok, why = spend_decision(25, "google", 50, 80, approved=True)  # 105 > 100 search
    assert not ok and "search sub-cap" in why
    ok2, _ = spend_decision(25, "meta", 50, 80, approved=True)      # non-search ok (75 <= 105)
    assert ok2


def test_caps_default_to_settings():
    # raised 26 Nov 2026 per Vincent (WhatsApp #145 "agree to Google Budget")
    assert settings.SPEND_TOTAL_CAP_CHF == 105.0
    assert settings.SPEND_SEARCH_CAP_CHF == 100.0
    # explicit caps override settings
    ok, why = spend_decision(10, "meta", 0, 0, approved=True,
                             total_cap=5, search_cap=5)
    assert not ok and "total cap" in why


def test_month_start_is_first_utc_day():
    ms = month_start_utc(datetime(2026, 11, 17, 23, 59, tzinfo=UTC))
    assert ms == datetime(2026, 11, 1, tzinfo=UTC)


# --------------------- Conversion targets (Vincent 2026-11-26) -------------

def test_targets_not_evaluable_without_metrics_feed():
    from app.api.v1.marketing_guard import evaluate_targets
    r = evaluate_targets(days=7, spend_chf=20.0, metrics_leads=0,
                         crm_leads=4, meetings=0, metrics_rows=0)
    assert r["status"]["cpl_ok"] is None          # never a false PASS
    assert r["actual"]["cpl_chf"] is None
    assert r["actual"]["leads"] == 4              # max(metrics, crm)
    assert r["status"]["leads_ok"] is False       # 4 < 5 weekly target
    assert r["status"]["meetings_ok"] is False
    assert "metrics feed empty" in r["note"]


def test_targets_evaluates_cpl_and_scales_window():
    from app.api.v1.marketing_guard import evaluate_targets
    r = evaluate_targets(days=14, spend_chf=60.0, metrics_leads=4,
                         crm_leads=1, meetings=2, metrics_rows=14,
                         cpl_target=40.0, weekly_leads_target=5,
                         weekly_meetings_target=2)
    assert r["actual"]["cpl_chf"] == 15.0
    assert r["status"]["cpl_ok"] is True          # 15 <= 40
    assert r["targets"]["leads"] == 10            # 5 * 14/7
    assert r["status"]["leads_ok"] is False       # max(4,1)=4 < 10
    assert r["targets"]["meetings"] == 4
    assert r["status"]["meetings_ok"] is False    # 2 < 4
    assert r["note"] == ""


def test_targets_cpl_fails_when_over_and_leads_pass():
    from app.api.v1.marketing_guard import evaluate_targets
    r = evaluate_targets(days=7, spend_chf=100.0, metrics_leads=2,
                         crm_leads=5, meetings=2, metrics_rows=7,
                         cpl_target=40.0, weekly_leads_target=5,
                         weekly_meetings_target=2)
    assert r["actual"]["cpl_chf"] == 50.0
    assert r["status"]["cpl_ok"] is False
    assert r["actual"]["leads"] == 5
    assert r["status"]["leads_ok"] is True
    assert r["status"]["meetings_ok"] is True


def test_conversion_target_settings_exist():
    assert settings.TARGET_CPL_CHF > 0
    assert settings.TARGET_WEEKLY_LEADS > 0
    assert settings.TARGET_WEEKLY_MEETINGS > 0
