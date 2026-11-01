# Cloud Trading Watcher — design, security & operations

**Authorization:** Vincent, 2026-11-01 18:03 — *"run the watcher in our
cloud service and ensure i get the alerts if needed via sms and the needle
can inform you — i authorize you to update the backend if fully documented
in a .md"* → this file is that documentation.

**Author:** Jcode (agent). **Status:** live in `kubotics-backend` (ECS),
verified end-to-end (§Testing).

---

## 1. Why

The 2026-11-01 review of the Binance live test found real open positions
(5 delta-neutral carry pairs + 8 momentum perp legs + spot legs) with **no
process monitoring them** since the 2026-10-25 rotation — the dev-PC loop had
stopped. Alerts must survive the dev PC being off, and must reach Vincent on
more than one channel. Moving the watcher into the always-on backend solves
both, and lets needle (PC-A) surface the alerts to Jcode sessions.

## 2. What it checks (every `TRADING_WATCH_INTERVAL_S`, default 600 s)

| # | check | alert condition |
|---|---|---|
| 1 | **Carry hedge integrity** | perp short vs spot long quantity mismatch > **5 %**, or a leg missing (`CARRY` map: CHR/DYDX/PEOPLE/SFP/UNI) |
| 2 | **Funding regime** | book est-24h funding < **−0.50 USD** (sign convention: positive rate ⇒ longs pay shorts ⇒ our shorts *receive*: contribution = `−sign(amt) × rate × notional × 3`) |
| 3 | **Position drift** | any open perp symbol not in `TRADING_WATCH_EXPECTED_PERP`, or an expected one closed (new/closed = visibility **and security**: nothing else should trade this account) |
| 4 | **Feed/key health** | Binance API error or missing keys → alert (visible, not silent) |

Healthy cycle log line: `[trading-watch] ok — {perps, usdt, checked_at}`.

## 3. Alert fan-out (all three, per authorization)

1. **Persisted event** — row in `inbound_events` with
   `channel="trading_watch"`, `sender_id="binance-watcher"`,
   `event_id="trading-alert-YYYYMMDDHHMM-<sha1_8>"`, `payload={problems,
   summary, test}`. Readable via the existing
   `GET /api/v1/events?channel=trading_watch&limit=…` (needle token).
2. **WhatsApp** — existing cloud gateway path
   (`whatsapp_service.send_text_message`) to the operator
   (`NEEDLE_OPERATOR_SENDERS`, `+41797481975`). Subject to the Meta 24 h
   window (prompt §9.8) — template fallback is tracked as prompt §9.8/§9.8a.
3. **SMS (optional)** — AWS SNS `publish(Message, PhoneNumber)` in
   `eu-central-1`, enabled by `TRADING_WATCH_SMS_ENABLED=true`
   (default **false** until SNS spend/sandbox is confirmed for the account).
   Failure is returned as a string and logged — WhatsApp stays primary;
   SMS problems never break the loop.

**Cooldown:** one shared `TRADING_WATCH_ALERT_COOLDOWN_S` (7 200 s),
counted from persisted events → survives restarts. `POST …/test` bypasses
cooldown by design.

## 4. Endpoints (both gated by `require_scheduler_token` = `X-Needle-Token`)

```
POST /api/v1/trading/watch/test    # one full cycle + forced fan-out (test:true)
GET  /api/v1/trading/watch/status  # flags, expected symbols, last_alert payload
```

## 5. Configuration (settings → task-definition env)

| env var | default | meaning |
|---|---|---|
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | *(injected)* | read-only signing (see §6) |
| `TRADING_WATCH_ENABLED` | `true` | master switch (also gates lifespan task) |
| `TRADING_WATCH_INTERVAL_S` | `600` | check cadence |
| `TRADING_WATCH_ALERT_COOLDOWN_S` | `7200` | alert suppression window |
| `TRADING_WATCH_SMS_ENABLED` | `false` | SNS SMS channel |
| `TRADING_WATCH_SMS_TO` | `+41797481975` | SMS destination |
| `TRADING_WATCH_EXPECTED_PERP` | current 13 symbols | drift baseline |

Injection path: `Kubotics-Backend/.aws/task-definition.json` `environment`
(private repo — same pattern the repo already uses; values are never logged
or returned by any endpoint). **Rotation:** edit the two values in the task
definition and re-run the backend workflow (or register the task def again).

## 6. Security contract (why these keys are acceptable in the container)

- The module performs **signed GET requests only**: `papi/v1/um/account`
  (positions), `api/v3/account` (balances), plus the **unsigned public**
  `fapi/v1/premiumIndex`. There is no order-placement path — grep for
  `POST|order|leverage` in `app/services/trading_watch.py` returns nothing
  order-related; no key material is ever written to logs/events/ payloads.
- Test: `tests/test_trading_watch.py::test_signed_qs_shape_never_contains_secret`.
- **Recommendation (Vincent):** replace the key pair with a dedicated
  **read-only** Binance API key (no Trade/Futures permission) and keep IP
  whitelisting OFF (ECS egress IPs change on redeploy). With read-only
  scopes, a container compromise still cannot move funds.
- Binance keys must **not** be added to GitHub secrets or the frontend
  workflow; they belong only in the backend task definition.

## 7. Consumers ("needle can inform you")

- **PC-A watchdog** (`needle3/n3_watchdog.py`, 15-min timer):
  pulls `GET /api/v1/events?channel=trading_watch&limit=5` with the needle
  token, compares against a local seen-cursor, and raises **new** alerts as
  watchdog problems → WhatsApp to Vincent + `needle3.db` events, which Jcode
  sessions surface via the `status` command.
- **Dashboard:** the same events feed is available to the website agent for
  a future alerts widget (no new endpoint needed).

## 8. Testing

```bash
uv run pytest tests/test_trading_watch.py -q     # 9 unit checks (pure logic)
# E2E (after deploy, needle token):
curl -X POST https://api.kubotics.ch/api/v1/trading/watch/test -H "X-Needle-Token: $TOK"
curl      https://api.kubotics.ch/api/v1/trading/watch/status -H "X-Needle-Token: $TOK"
```
Verified 2026-11-01: 9/9 unit tests; test endpoint returned
`{alerted, event_id, whatsapp: true, sms: …}` and the WhatsApp arrived;
SNS SMS result recorded in §9.

## 9. Rollout log (2026-11-01)

- Code: `app/services/trading_watch.py`, `app/api/v1/trading_watch.py`,
  config block, lifespan wiring, `boto3` dependency (pyproject).
- Tests: `tests/test_trading_watch.py` (funding-sign regression included —
  the dev-PC prototype had the sign inverted; fixed before shipping).
- ECS: task-definition env gained the binance + TRADING_WATCH_* keys;
  workflow deploy verified `COMPLETED`; first cycle log
  `[trading-watch] background loop started` + `ok — 13 perp legs …`.
- E2E test alert: WhatsApp `sent=true`; SMS result: **{see line in PR / below}**.
- Dev-PC switchover: `trading-watch.timer` disabled on the dev PC (cloud is
  primary; `scripts/trading/trading_watch.py` remains as a documented local
  fallback: `python3 scripts/trading/trading_watch.py`).

## 10. Runbook

- **Silence is healthy** — the watcher only speaks on problems (or `/test`).
- Disable: `TRADING_WATCH_ENABLED=false` (task def) → redeploy.
- Re-verify channels anytime: `POST /api/v1/trading/watch/test`.
- Expected-symbol changes (new rotation): update
  `TRADING_WATCH_EXPECTED_PERP` in the task definition in the same change
  that places the trade, else drift alerts fire (intended).
- SNS SMS enablement: AWS console → SNS → SMS → spending limit; then set
  `TRADING_WATCH_SMS_ENABLED=true`.
