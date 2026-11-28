# Cloud & Edge Topology — authoritative map for agents

Last verified: **2026-11-28 ~07:45 CET** by live inspection (AWS CLI, RDS,
Binance read-only API, both edge PCs). States recorded here are a snapshot:
**always re-verify live state before acting** — services get scaled, stopped
and redeployed (this document exists because one of them sat at zero for
16 days unnoticed).

## 0. TL;DR

- **Cloud hub** = `Kubotics-Backend` (FastAPI) on ECS `kubotics-cluster`,
  data in RDS (`kubotics` + `akuris` databases). Everything WhatsApp-side
  (webhook, inbox, outbound send), IBKR, lead followups, mail, ads-adjacent
  reporting and the cloud watchdog live here.
- **Binance trading bot** = ECS `akuris-cluster` service `ai-trading-service`
  (separate repo `~/development/AI-Trading`), writes `akuris.ai_trading` in
  the same RDS. **It is a service with a desired count — check it.**
- **Edge** = PC-A runs the `needle3` WhatsApp queue worker, PC-B is its hot
  standby (backup mode), the dev PC runs agent dev-sessions + trading code
  repos. All three reachable non-interactively; PC-A/PC-B have passwordless
  root via `/etc/sudoers.d/90-agent` (since 2026-11-28).

## 1. AWS (account 056742285656, CLI profile `h2rl`, region eu-central-1)

| Cluster | Service | What |
|---|---|---|
| `kubotics-cluster` | `kubotics-backend-service` | The platform backend (target of every push to `main`) |
| `akuris-cluster` | `ai-trading-service` | **Binance trading bot** (task def `ai-trading-task`, image ECR `ai-trading-service:latest`, logs `/ecs/ai-trading`) |
| `akuris-cluster` | whatsapp/mail/auth/api/… `*-task-service-*` | Legacy Akuris platform microservices (not Kubotics) |

Status check (works today):

```bash
aws --profile h2rl ecs describe-services --cluster akuris-cluster \
  --services ai-trading-service --region eu-central-1 \
  --query 'services[0].{running:runningCount,desired:desiredCount,taskDef:taskDefinition}'
```

**Known incident (found 2026-11-28):** `ai-trading-service` had
`desired=0, running=0` since the deployment of task def **:72 on
2026-11-12 20:34 CET** — the bot did **not run for 16 days** while everything
else looked healthy. Evidence: `ai_trading.bot_state.updated_at` frozen at
2026-11-12 20:23, `ai_trading.trades` empty (3,810 history rows archived to
`trades_arch_20261112`, last archived trade 2026-10-19), local
`jcode_strategy` state files mtime 2026-11-12 12:53. Never assume the bot
runs; read `runningCount` first.

## 2. Cloud backend (Kubotics-Backend)

Deploy: push to `main` of `git@github.com:vincent-verbeke/Websites.git`,
gated by `uv run --frozen pytest -q` in the **root** workflow
(`.github/workflows/deploy.yml` only — nested workflow files are ignored).

Responsibilities (all cloud, no dev-PC dependency by design):

- **WhatsApp**: Meta webhook → `crm.needle_inbox` (status `new`); outbound
  `POST /api/whatsapp/send` (Bearer `NEEDLE_TOKEN`); agent acks
  `POST /api/v1/needle/ack`.
- **`needle_watchdog`** (`src/app/services/needle_watchdog.py`): alerts when
  a row is unclaimed >10 min or a dispatch goes stale; works even when PC-A
  is dead; **never mutates the queue**.
- **IBKR**: sole MCP holder + daily plan runner (Mon–Fri 09:05–16:30) —
  `docs/IBKR_MCP_BACKEND.md`.
- **`trading_watch`**: Binance price/threshold *alerts* to the
  `trading_watch` channel + SMS — `docs/TRADING_WATCH_CLOUD.md`. Alerting
  only, it is **not** the trading strategy.
- Mail agent (`docs/MAIL_AGENT_REPLY_TRUTH.md`), lead followups, M365 email
  sending, lead/CRM APIs, conversion goals (KUB-G).

Ops gotchas:

- M365 email scripts must run with **cwd = repo root**
  (`/home/vincent/Coding/Websites/Kubotics-Backend`) or `certs/m365_app.key`
  is not found; interpreter `.venv/bin/python`.
- RDS: host `app-akuris.cluster-cdksucuwyw2t.eu-central-1.rds.amazonaws.com`
  (the AI-Trading `.env` uses the alias
  `app-akuris-instance-1.cdksucuwyw2t…` — same cluster, both work).
  Databases: `kubotics` (schema `crm` = needle_inbox, threads, contacts,
  followups…) and `akuris` (schemas below).
- `kubotics_app` **cannot read** schema `ai_trading` (permission denied) —
  use the `aitrading` user from `~/development/AI-Trading/.env`.

## 3. Binance trading (the money system)

- **Runtime**: ECS `ai-trading-service` = `python main.py` (bot loop) +
  `uvicorn api.main:app :9090` (monitoring API), see
  `AI-Trading/scripts/entrypoint.sh`.
- **State**: RDS `akuris` schema `ai_trading` (owner `aitrading`):
  `trades`, `bot_state`, `cycle_history`, `logs` (ERROR-only), `paper_portfolio`,
  `strategy_versions`; `binance` schema = legacy Akuris-era (owner
  `akuris_pg_admin`, empty-of-relevance), `trading_schema` = empty.
- **Mode/rails** (`AI-Trading/.env`): `DRY_RUN=false` (LIVE),
  `RISK_PER_TRADE=0.005`, `MAX_POSITION_SIZE_PCT=30`, `RESERVE_PCT=0.07`,
  `MAX_LEVERAGE=10`, `LEARNING_CYCLE_TRADES=100`. Kill switch:
  `jcode_strategy/STOP` file (absent = not stopped).
- **API key permissions** (read 2026-11-28): spot+margin trading, portfolio
  margin, vanilla options, read, universal-transfer query;
  **futures OFF** (`fapi` returns 401), **withdrawals OFF**, no IP whitelist.
- **Budget context** (measured 2026-11-28, read-only API): Vincent's added
  CHF 5,000 (SWIFT 2026-11-12 11:39 UTC) → converted to **5,839.84 USDT**,
  moved spot→margin 13:25 the same day (`MAIN_MARGIN` transfer), 2,000 USDT
  sent back to spot 13:29 (`MARGIN_MAIN`). Current wallets: **spot ≈ 2,561
  USDT** (2,000 free + USDC 2.74 + legacy alt bags ≈ 559 — the Oct-17
  "close old positions" never fully happened), **cross-margin USDT
  3,909.78**, **Portfolio-Margin `totalAvailableBalance` 4,192.49** (the
  bot's capital view — likely a superset of the margin balance), funding/UM
  futures 0 (futures disabled on the key). Roughly **6.5–6.8k USDT total**
  plus IBKR (~CHF 9.8k equity = the separate ~10k test capital). **Zero
  trades since 2026-10-19** (no spot/margin trades on majors since Nov 1
  either) → no trading losses; the money is parked idle. Plan doc:
  `jcode_strategy/BUDGET_PLAN_2026-10-17.md`.
- **`jcode_strategy/`** (carry/live runners, file-based state) are **dev-PC
  scripts, not a cloud service** (last run 2026-11-12 12:53).
- **Capital sizing**: `executor.get_deployable_capital()` =
  `GET /papi/v1/account → totalAvailableBalance × (1 - RESERVE_PCT)` —
  i.e. the bot trades the **Portfolio-Margin available balance**, not spot.
- The **daily evening PnL email** is produced by the bot — expect none while
  `desired=0`.

## 4. Edge machines

| Host | Access | Runs |
|---|---|---|
| PC-A `ubuntu-automation` 192.168.1.199 | `ssh wa@…`, root `sudo -n` (`/etc/sudoers.d/90-agent`), `vincent@` SSH **disabled** | `needle3.service` (workdir `/home/wa/needle3`, unit sets `N3_CONFIG`/`PYTHONPATH`), `n3_watchdog.py`, HA VM 192.168.1.200 (bridged) |
| PC-B `ubuntu-services` 192.168.1.170 | `ssh vincent@…`, root `sudo -n` (`90-agent`) | `needle3.service` in **backup mode** (workdir `/home/vincent/needle3`, `tasks_enabled=false`; cursor in `meta` table; claims rows unclaimed >10 min if PC-A dies) |
| Dev PC 192.168.1.161 | local | agent dev-sessions (`n3-*`), `~/development/AI-Trading`, `~/development/needle3` (source, git, no remote), Google Ads scripts |

needle3 deploys: copy changed files to `<workdir>/needle3/*.py` (`.bak`
first) + `systemctl --user restart needle3`. **`config.py` must ship together
with `daemon.py`** (missing flags ⇒ crash-loop). Test on the box:
`cd <workdir> && python3 tests/test_retry.py`.

## 5. WhatsApp end-to-end + reliability contract

```
Meta → webhook (cloud) → crm.needle_inbox
     → PC-A needle3 polls GET /api/v1/needle/inbox
     → route (help/status/trading/dev-task/…) → claim POST …/needle/ack
     → dev session on dev PC (n3_forced_command.sh over SSH) or direct answer
     → POST /api/whatsapp/send → Meta
```

Since 2026-11-28 (needle3 commits `2653a9d`, `bb4410e`):

- **WAF**: Cloudflare 403s any payload containing path-traversal shapes
  (`.../`, `../`, `%2e%2e/`). `wafscrub.py` redacts them from every send and
  ack (trigger example: the literal `.../auth/callback` inside an answer).
- **Retries**: send-before-ack; `send_pending_*` = resend the exact stored
  text next tick; `ack_*_pending` = ack-only retry, **never re-sends** an
  answer. A row is only final after the network confirms.
- **`stopped` sessions** terminate properly (answer → done; prompt-only →
  plain-language failure, never echoes the question back).
- Cloud `needle_watchdog` still alerts on stuck rows either way.

Bisect oracle for future WAF hits: POST a fake-id `/ack` — `404` = passes,
`403` = blocked (isolates the payload trigger without touching real rows).

## 6. Rules that apply to every agent/subagent

1. **Review-first**: money, ads, brand and brand-adjacent mutations need
   Vincent's explicit GO (quote his words); destructive/non-reversible
   actions get confirmed even with root access.
2. Replies to Vincent are in **English**.
3. **Verify live state before assuming** — this document's states are dated.
4. WhatsApp to Vincent only when *his* action is needed (plus configured
   trading/alert channels).
5. Keep the pytest gate green before pushing to `main`.
