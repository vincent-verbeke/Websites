# WhatsApp gateway → Azure container: migration review

_Status: review only, nothing migrated. Prepared 2026-11-01 by Jcode from a live
inventory of the running systems. Open questions are at the end._

## 1. What "the WhatsApp gateway" is today (as-built inventory)

Three machines are involved. **Nothing on this box talks to Azure today** — there
is no `az` CLI, no `~/.azure`, no Azure host in Tailscale/SSH, and no Azure
artifact in either repo (the Kubotics production deploy is **AWS ECS Fargate**,
see `README.md` §1/§4/§5).

| # | Component | Where | How it runs | Holds secrets? |
|---|-----------|-------|-------------|----------------|
| 1 | `wa_core.py serve` — Cloud API client + inbox store (send_text, send_template, verify/hub.challenge, ingest, unread/mark_read). "The ONLY component holding the Meta token" (its own docstring) | PC-A `~/wa-edge`, port **8444** (`/api/whatsapp/send`) | **Orphan process** — `wa-core.service` unit file exists in `~/wa-edge/units/` but is *not installed* (`systemctl --user is-enabled wa-core` → not-found) | Yes: `edge_config.json` → `wa_token`, `verify_token`, `phone_number_id`, `send_token`, `allowed_senders`, `default_to` |
| 2 | Router + webhook front (`webhook_front:app` on 127.0.0.1:8443, unit comment: *"public allowlist - the funnel target"*) | PC-A `~/wa-edge`, units `wa-router`, `wa-webhook` | **Not installed / not running** | Reads `edge.env` (H2_* upstreams) |
| 3 | `edge_app` dashboard host/relay (relays control POSTs to the dev PC, caches reads, exposes `/api/whatsapp/` passthrough) | PC-A `~/wa-web`, port **8001** | Orphan uvicorn process | `web.env`, M365 certs |
| 4 | `scripts/whatsapp/wa.py` — second, independent Cloud API client (stdlib), used by Jcode sessions, `daily_invest.py`, `ibkr_watch_static.py` | dev PC (this box) | Called ad-hoc per send | Yes: `scripts/whatsapp/wa_config.json` → access token, `phone_number_id`, `waba_id`, `opt_out` |
| 5 | Inbound webhook receiver (Meta `GET/POST /api/whatsapp/webhook`, verify challenge, operator lane → `needle_inbox`) | **Kubotics-Backend**, port **8000** (this box, now a systemd unit) + same code in the AWS ECS container (`api.kubotics.ch`) | `kubotics-backend.service` (created 2026-11-01, enabled, Linger=yes) | `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `NEEDLE_TOKEN`, `NEEDLE_OPERATOR_SENDERS` |
| 6 | needle3 orchestrator (polls inbox, dispatches dev sessions, replies) | PC-A, port n/a (outbound only) | `needle3.service` (enabled 2026-11-01) → polls `http://192.168.1.161:8000` | `needle_token`, `send_token` |

Supporting state that is **file-based and shared**:
`~/wa-edge/store/inbox.json` (read by needle3's SMALL-conid flow),
`store/opt_out.json`, `store/reply_map.jsonl`, `web/chat/inbox.json` (dev PC).

## 2. Defects found during the review (independent of the migration)

1. **PC-A gateway processes are unsupervised.** Unit files exist under
   `~/wa-edge/units/` but were never installed → `wa_core` (8444) and `edge_app`
   (8001) are orphan processes: no `Restart=`, no boot start, silent death.
2. **Inbound store is stale:** `store/inbox.json` last written **2026-10-26 13:27**,
   i.e. inbound WhatsApp ingestion stopped the same week needle lost actions.
3. **Two Meta-token holders** (`wa_config.json` on dev PC, `edge_config.json` on
   PC-A) plus a third inside Kubotics-Backend `.env` — token rotation must touch
   all three, and audit/24h-window behaviour differs between them.
4. **Needle intake backend was down 2026-10-26 20:36 → 2026-11-01 11:51**
   (15,577 connection-refused polls). Fixed today: `kubotics-backend.service`
   now runs it permanently; `needle3.service` enabled; `dry_run` turned off
   (backup `needle3.json.bak_pre_dryrun_fix_20261101`).
5. **Meta webhook target is unverifiable from this machine** — the local token
   has no `subscribed_apps` permission (Graph returns "#100 nonexisting field").
   `https://api.kubotics.ch/api/whatsapp/webhook` answers (403 = route alive,
   verify-token mismatch vs local token), so production AWS is at least
   *capable* of receiving it. Whoever controls the Meta App Dashboard must
   confirm the current callback URL.

## 3. What the Azure container needs (checklist)

**A. Inputs I still need from you (blocking):**
- Which container: subscription / resource group / container name or FQDN,
  and whether it already runs an image or is empty. I could not discover it
  from this machine (no `az` CLI, no Azure credentials, no Azure host on the
  tailnet). `az login` (or a service principal + `AZURE_*` env) is required
  before I can inspect or deploy to it.
- Whether the container has (or can get) a **public HTTPS endpoint with a real
  certificate** — Meta webhooks require public HTTPS (the tailnet funnel only
  covers `kuroliv-ros.tail8c17d3.ts.net → 127.0.0.1:8001`, i.e. the dashboard).
- Which side moves: (i) full gateway (inbound webhook **and** send API), or
  (ii) send-only, keeping Meta → AWS/local webhook.

**B. Image/runtime contents (all identified, all portable):**
- `wa_edge` app = `wa_core.py` (+ router + `webhook_front` if inbound moves).
  Stdlib-only Python + a venv → small image; Docker base `python:3.12-slim`.
- Config/secret set to mount: `edge_config.json` keys (`wa_token`,
  `verify_token`, `phone_number_id`, `send_token`, `allowed_senders`,
  `default_to`, `api_base`, `send_api`) → prefer Key Vault / container env,
  never baked into the image.
- Persistent volume for `store/` (inbox, opt_out, reply_map) — or replace the
  files with the Postgres `needle_inbox` table to remove file coupling.
- Healthcheck endpoint (`/healthz`) + outbound 443 to `graph.facebook.com`.

**C. Callers that must be re-pointed (and tested):**
1. `needle3` on PC-A: `send_url http://192.168.1.199:8444/api/whatsapp/send`
   → Azure URL (+ token). Keep `opt_out_path` semantics.
2. `needle3.small_from_inbox()` greps **PC-A local** `store/inbox.json` →
   needs the store to stay on PC-A, or an API on the container it can query.
3. `wa.py` callers on the dev PC (IBKR runs, watchers) → either keep `wa.py`
   as-is (it talks to Meta directly and works anywhere) or point it at the
   container to have one token holder.
4. Kubotics-Backend operator lane (webhook → `needle_inbox`) + needle3's poll
   URL `http://192.168.1.161:8000` — unchanged if the webhook stays where it
   is, but must change if the container also takes over intake.

**D. Meta side:** App Dashboard → WhatsApp → Configuration → webhook callback
URL + verify token update, subscribe `messages` field; keep the old callback
until the new one answers `hub.challenge` (zero-downtime cutover, same trick as
the `GET /webhook` verifier already in the code).

**E. Cutover plan (recommended order):**
1. Provision container, deploy send API only, point *one* non-critical caller
   (Jcode `wa.py` notify path) at it, verify a delivery receipt (`wamid`).
2. Move `needle3 send_url`, watch one real reply round-trip.
3. Move inbound webhook (Meta callback change) with the local receiver left
   running as a fallback for 24h; compare `needle_inbox` rows.
4. Decommission PC-A orphan processes only after 7 days of clean traffic;
   install the systemd units in the meantime as the fallback safety net.

**F. Ops concerns to decide:** region (EU/CH for data residency), always-on
cost vs the current free home-lab setup, log/metric pipeline (today: journal +
`store/*.jsonl` only), secret rotation runbook covering the three token holders.

## 4. Open questions

1. **Which Azure container?** (name/subscription/endpoint, or confirm you want
   me to create one and with what tooling — `az` CLI is not installed here.)
2. Is production staying on **AWS ECS** (`api.kubotics.ch`) — i.e. is Azure
   meant to *replace* the PC-A gateway only, or also the ECS backend?
3. Should the three Meta-token holders be **consolidated** to the container
   during this migration (recommended) or kept independent?
4. Consent to the two resilience fixes already staged: PC-A `wa-*` systemd units
   installed+enabled (currently orphaned), and `dry_run=false` (done today,
   backup kept) so needle replies actually go out.
