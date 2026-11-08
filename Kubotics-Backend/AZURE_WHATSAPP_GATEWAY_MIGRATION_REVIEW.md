# WhatsApp gateway migration review — Azure question vs. AWS reality

_Review only; updated 2026-11-01 13:05 CET after live validation. Original
version written 11:00 the same morning; §4 answers recorded from Vincent's
11:43 reply; restored after an accidental `git checkout` reverted the
previous revision (docs now committed)._

## TL;DR

- **No Azure container exists** (Vincent confirmed 2026-11-01: "we have no
  azure containers => All on AWS"). The only Azure material is M365/Entra
  credentials (used by the new dashboard login).
- The **cloud container is AWS**: ECS Fargate
  `kubotics-cluster/kubotics-backend-service` (task def
  `kubotics-backend-task`, eu-central-1) behind CloudFront + ALB at
  **`https://api.kubotics.ch`**. Validated: **WhatsApp webhook and the Needle
  intake both run in that container.**
- The practical migration = **consolidating the remaining PC-A pieces onto
  the AWS container**, per Vincent's decisions in §4 (all of them are now
  mirrored into the website agent's spec, `../Kubotics/PROMPT_website_agent_dashboard_cloud_2026-11-01.md`
  §7).

## 1. As-built inventory (validated 2026-11-01)

| # | Component | Runs where | Status |
|---|-----------|-----------|--------|
| 1 | **WhatsApp webhook receiver** `GET\|POST /api/whatsapp/webhook` (verify challenge, operator lane → `needle_inbox`) | **AWS ECS container** (`api.kubotics.ch`) | ✅ challenge 200 through CDN, 401 without needle token |
| 2 | **Needle intake** `/api/v1/needle/{inbox,ack,inject}` + `X-Needle-Token` | **AWS ECS container** | ✅ 200 with task-def token; **PC-A needle3 polls the cloud** (`backend: OK (latest_id=4, unseen=0)`) |
| 3 | `wa_core.py` — Cloud API **send** client + inbox store (`/api/whatsapp/send`, port 8444) | PC-A `~/wa-edge`, **orphan process** (unit files exist, never installed) | ⚠️ to move into the container (decision 2), then retire |
| 4 | Router + `webhook_front` (unit `wa-webhook`) | PC-A | ⚠️ not installed, not running |
| 5 | `edge_app` dashboard host/relay (port 8001) | PC-A, orphan uvicorn | 🔄 moving to the cloud — see prompt (dashboard work delivered as `a990349`, backend half currently broken, prompt §8) |
| 6 | `wa.py` — independent Cloud API client (Jcode sessions, `daily_invest`, watchers) | dev PC | ✅ works anywhere; token holder #2 to be consolidated |
| 7 | needle3 scheduler + **watchdog** (new 2026-11-01) | PC-A `needle3.service`, `n3_watchdog.timer` (15 min) | ✅ polling cloud, `dry_run=false`, opt-out-aware alerts |

Token/secret reality:
- `NEEDLE_TOKEN`: ECS task-def env and local `.env` are the **same value**
  (hash-compared) — no rotation needed.
- `WHATSAPP_VERIFY_TOKEN`: identical too (challenge verified 200 through the
  CDN).
- Meta **access** token: two holders today (`wa_config.json` on dev PC,
  `edge_config.json` on PC-A) → consolidate into the container (decision 3).

## 2. Defects found and fixed on 2026-11-01 (chronological)

1. **Needle intake backend down 2026-10-26 20:36 → 2026-11-01 11:51**
   (15,577 refused polls; the "lost actions" week). Fixed: local
   `kubotics-backend.service` as bridge, then needle3 re-pointed to
   `https://api.kubotics.ch`.
2. **CloudFront stripped `X-Needle-Token` and query strings** from
   `api.kubotics.ch` (cache policy whitelisted only 5 headers, no origin
   request policy) → needle 401, WhatsApp verify 403, and any header/query
   API call failed (plausible cause of the GTM P0 conversion-route failures).
   **Fixed:** managed origin-request policy `AllViewer` attached (deployed
   12:16); rollback snapshot at `~/.jcode/scratch/api_kubotics_cf_config_rollback.json`.
   Verified: needle 200/401 with/without token, verify challenge 200,
   distinct bodies per `after_id`, `x-cache: Miss` (API not cached).
3. **`api.kubotics.ch` outage 12:17–12:30 (502/504).** Cause: the ECS
   **service had no load balancer attached** (`loadBalancers: []`) — target
   registration was a stale manual entry, invisible until the first redeploy.
   **Fixed:** target group attached (`containerName=kubotics-backend`,
   `containerPort=8000`) so ECS manages registration; stale IP deregistered.
   Verified: health 200, targets healthy.
4. **`a990349` backend deploy fails at import** (`cloud_dashboard.py:17`
   imports non-existent `Lead`) — full traceback + fix options in the website
   agent's prompt **§8**; prod unaffected (see 5).
5. **Circuit breaker proven live 13:02:** *"deployment failed: tasks failed
   to start" → rolling back*, prod health 200 the whole time. (It was already
   enabled with `rollback:true, threshold 50%` — it had been inert only
   because of #3; no action needed, only an optional alarm.)
6. **needle3 `dry_run=true`** left over from 10-25 tests → set `false`
   (backup `needle3.json.bak_pre_dryrun_fix_20261101`).
7. **Needle watchdog added** (`n3_watchdog.timer`, every 15 min): error-burst
   (≥20/20 min with no info events) + backend reachability, alerts via PC-A
   send API with 2 h cooldown, opt-out respected, `--simulate` validated.

## 3. What moving the rest to the cloud needs (AWS target)

**Done:** webhook receiver + needle intake in the container (**migration
validated 2026-11-01 13:27+: Meta verify challenge 200, needle inbox 200,
inbound logs show Meta GET verify 200**), needle3 polling the cloud, CDN
header/query forwarding, ECS↔LB registration, watchdog, circuit breaker,
**send path cutover 13:35** (task def :15 carries the Meta send credentials,
needle3 `send_url` → `https://api.kubotics.ch/api/whatsapp/send`, real
round-trip `wamid.HBgL…` delivered; PC-A :8444 has no consumers left).

**Remaining (ordered):**
1. ~~**Send API in the container**~~ **DONE → CLOSED 2026-11-08 (a21 retirement):**
   contract §7.2 landed; needle3 `send_url` switched 2026-11-01 13:35 with a
   verified `wamid.HBgL…` round-trip, re-verified since (send/health
   `configured=true` on 2026-11-08; last_send success 2026-11-06). The 1-week
   PC-A fallback soak ENDED today — retirement executed, see §4 item 4 and the
   **2026-11-08 retirement result** at the end of this doc.
2. **Token consolidation** — two Meta access-token holders → container only;
   sequence + rotation-window notice in prompt §7.3.
3. **Dashboard** SPA + relay replacement — spec in the prompt (§2/§3): task
   queue, GTM metrics, fail-closed telemetry, outbound-pull control channel.
4. **Meta webhook target** — confirm the active callback URL in the Meta App
   Dashboard (local token lacks `subscribed_apps`); cut over with 24 h dual-run
   if it is not `https://api.kubotics.ch/api/whatsapp/webhook`.
5. **Alarm/notification** (optional): CloudWatch `UnHealthyHostCount >= 1` →
   SNS/WhatsApp so incidents page instead of being noticed by hand.
6. **Shared file state** (`store/inbox.json`, `opt_out.json`,
   `reply_map.jsonl`) — replace with API reads or keep a thin sync before
   retiring `wa_core`.

## 4. Open questions → **answers recorded 2026-11-01 (Vincent)**

1. ~~Azure or AWS?~~ **ANSWERED: AWS only — "we have no azure containers =>
   All on AWS."** Integration-plan updates added to the website agent's spec
   as prompt **§7.1** (no Azure design paths anywhere).
2. ~~Send path?~~ **ANSWERED + EXECUTED 2026-11-01 13:35**: needle3 now posts to
   `https://api.kubotics.ch/api/whatsapp/send` (verified `wamid` receipt); PC-A
   `wa_core` kept running as fallback for the 1-week soak, then retired (a21).
3. ~~Token consolidation?~~ **ANSWERED: yes, consolidate in the same move** —
   sequence in prompt §7.3, rotation window announced to Jcode so no
   scheduled run fires with a stale token.
4. ~~**PC-A `wa-*` systemd unit install — recommend CANCEL (validated 13:36)**~~
   **CLOSED 2026-11-08**: the a21 retirement ran (1-week soak over); the wa-*
   units were never installed (a12 stays cancelled, script untouched) and
   `edge_config.json` was deprecated in place (backup
   `edge_config.json.bak_20261108` retains the original token). Units would
   supervise retired services — no longer an open question. Residual: `wa_core`
   refused to stay dead (respawned unexplained 5 s after kill) → kept running
   per the retirement prompt's report-not-improvise rule; details in the
   **2026-11-08 retirement result** below.
5. ~~ECS circuit breaker~~ **RESOLVED — already enabled**
   (`rollback:true`, threshold 50%); it needed the load balancer attached to
   receive a health signal (fixed §2.3) and **proved itself live at 13:02**
   by auto-rolling back the failed `a990349` deployment with prod at 200
   throughout. Optional alarm = open item 5 above.

**Errata (Jcode, 2026-11-02 17:03):** this doc's citations of "prompt §7.1"
and "prompt §7.2" were dangling from day one — git archaeology (12 prompt
revisions + 60 repo revisions + deleted-file sweep) shows those sections were
never committed anywhere; only §7.3 ever existed. The contract has been
reconstructed in the prompt as **§7.1/§7.2 RECONSTRUCTED** (behavior-level,
every point live-observed 2026-11-01/02: 200+wamid round-trip, 401 without
token, health keys sans secrets, CloudFront→ALB→ECS chain). Future readers:
cite the reconstruction, not the lost originals.

## 2026-11-08 retirement result (a21 / sched_8b725532, executed by Jcode 09:01–09:13 UTC)

- **Step 1 (no consumer):** needle3 runtime json = cloud `send_url` (zero `8444`
  refs); `config.py` legacy default = sanctioned dead default (pre-flight note).
  PC-A sender-file scan: `wa-edge/edge.env`, `wa-edge/edge_config.json`,
  `needle3/needle3/config.py`, `wa-web/web.env`, `wa-web/edge_app.py` —
  `edge.env`/`web.env` are **beyond the approved disambiguation list →
  reported, not touched** (env files of the superseded legacy stack; no runtime
  sender found). Dev-PC scan: test fixture + `edge_app` source + two docs only.
- **Step 2:** `GET /api/whatsapp/send/health` → `configured=true`,
  `last_send 2026-11-06 ok` → no extra round-trip sent (per rule).
- **Step 3 (stop orphan):** kill executed → old `wa_core` dead, but a new
  instance (pid 3017472, PPid 1) was up **5 s later**. Spawn source UNEXPLAINED
  after an exhaustive search: `wa-core.service` not installed, no crontab /
  at / anacron reference, no ssh login in the journal window, no tmux/screen,
  no keeper loop, `router.py` / `edge_app.py` contain no spawn code, and
  `wa_core.py serve` has no self-restart. → **kept running per the prompt's
  report-not-improvise rule; question raised to Vincent (did he restart it
  ~10:05 CET?).** Scope note: `edge_app` :8001 (pid 197277) and
  `webhook_front` :8443 (pid 40313) are **RUNNING → left alone** as approved.
- **Step 4:** `edge_config.json` → backup `edge_config.json.bak_20261108`
  (original token retained ONLY there), `wa_token=""`,
  `deprecated="moved to ECS task def 2026-11-08, see prompt §7.3"` (token
  length recorded, value never printed).
- **Step 5:** needle3 `ctl status` → backend OK, cursor 39, unseen 0.
- **Step 6:** this doc (§3 item 1 → DONE, §4 item 4 → CLOSED) + one WhatsApp
  report sent (including the respawn anomaly, scope-proc statuses and the
  `edge.env`/`web.env` findings).
