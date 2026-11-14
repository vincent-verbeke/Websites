# Light H2 dashboard — implementation plan (2026-11-14)

> **STATUS 2026-11-14: IMPLEMENTED (code landed, default = cloud = zero
> behavior change).** Shipped with this batch: `DashboardConfigService`
> (`src/app/core/services/dashboard-config.service.ts`), mode file
> `public/dashboard-mode.json` (served at `/dashboard-mode.json`, currently
> `{"mode":"cloud"}`), tab allowlist + `setTab` allowlist guard + cloud-view
> gating in `dashboard.ts`, `spend-control` API base through the config,
> 4 unit tests (`dashboard-config.service.spec.ts`). Verified: `ng build`
> green, `npm test` 41/41 green. Remaining = the robot-side cutover in §5
> (needs the H2 powered on) and Vincent's decisions in §6.

Scope per Vincent: *"a light version of the dashboard that we can implement
on the H2 (auth remains the same), it is about a local integration, we don't
need the investments part etc, but only the local features such as controls so
we can ensure to use it locally on the H2."* The H2 is off today; deliverable
must be ready to switch on when the robot is (tomorrow / later today).

## 1. What exists today

`Kubotics/src/app/pages/dashboard/dashboard.ts` (1,141 lines) renders one tab
bar with **16 tabs**:

| tab id | label | local (robot) or cloud |
|---|---|---|
| `overview` | Cloud Orchestrator (KPIs, leads, conversations, spend) | cloud |
| `twin` | Digital Twin (H2) | **local** |
| `investments` | Investments & IBKR | cloud (drop for H2) |
| `services` | Services Manager | **local** |
| `system` | Thermals & System | **local** |
| `management` | Robot Management | **local** |
| `lidar` | LiDAR Diagnostics | **local** |
| `motion` | Motion Control | **local** |
| `vision` | Vision & Cams | **local** |
| `voice` | Voice Bot | **local** |
| `chat` | Jcode Chat | local session |
| `sessions` | WhatsApp Sessions | cloud (drop for H2) |
| `ha` | Home Assistant | **local** |
| `training` | RL Training | **local** (PC3, same LAN) |
| `ollama` | Ollama Models | **local** |
| `software` | Software Updates | **local** |

Auth: `core/services/azure-auth.service.ts` (Entra ID, phone/MS sign-in) +
`core/guards/auth.guard.ts` — **unchanged**, also on the H2 ("auth remains
the same").

Hardcoded today: `API_BASE = 'https://api.kubotics.ch/api/v1'` inside
`dashboard.ts` (line ~1003). Legacy feature components under
`pages/dashboard/legacy/` are already **config-driven** ("everything is inert
while `AUTH_ENABLED=false` (default)") and speak host-local APIs
(`/api/vision/*`, `robot_dashboard_server.py` H2_JOINTS …), which is the
pattern the light build should follow.

## 2. Recommended design (single build, two modes)

**Runtime mode file, not a fork** — one code path, no double maintenance:

1. **Shipped:** `public/dashboard-mode.json`, served at the host ROOT as
   `/dashboard-mode.json`:
   ```json
   { "mode": "cloud", "apiBase": "https://api.kubotics.ch/api/v1" }
   ```
   The H2 copy ships `{"mode":"h2-local","apiBase":"http://localhost:<port>/api/v1"}`
   (edge/robot web host — confirm the exact local port when the H2 is up;
   `h2-web-host.service` + `edge_app` port 8001 are the candidates). Missing/
   unreadable file = cloud defaults (fail-soft, tested).
2. **Shipped:** injectable `DashboardConfigService` (signals `mode()`,
   `apiBase()`, `isLocal()`, `allowedTabIds()`), fetched once per load.
   `dashboard.ts` and `spend-control.component.ts` read `apiBase()` instead
   of the hardcoded URL (legacy `legacy/core/api.ts` was already **relative
   `/api/...`** — correct for the robot, untouched).
3. **Shipped:** tab allowlist per mode (single source, in the service):
   ```ts
   CLOUD_TAB_IDS   = all 16
   H2_LOCAL_TAB_IDS = ['overview','twin','services','system','management',
                       'lidar','motion','vision','voice','chat','ha',
                       'training','ollama','software']   // 14 — drops
   // investments + sessions (both cloud-only)
   ```
   Tabs render from `visibleTabs()`; `setTab()` re-checks the allowlist
   (defence in depth) and a disallowed active tab redirects to `overview`
   with the drill-down views reset.
4. **Shipped:** `overview` in h2-local mode = local status page — the cloud
   blocks (KPI cards, spend/leads/conversations drill-downs, Needle task
   queue) are gated by `@if (!cfg.isLocal())`; the device telemetry strip
   stays.
5. Views `selectedView ∈ {'leads','conversations','spend'}` are cloud-only:
   never settable in h2-local (template gate + `setTab` guard).

Why runtime mode instead of a second Angular build config: the robot and the
cloud run the same `main-*.js`; a `h2Local` `fileReplacements` build would
work too but creates a second artifact, a second deploy path and drift risk —
Vincent's stability requirement ("critical that this works stable") favors
one artifact + a 6-line config file per host.

## 3. Auth on the H2

Unchanged (explicit requirement): Entra ID login via
`azure-auth.service.ts`, `auth.guard` on `/dashboard`.
Operational notes to verify when the H2 is on:

- The robot serves over LAN; Entra sign-in needs internet egress — fine on
  the shop floor, and MSAL redirect URIs must include whatever origin the H2
  serves on (today the URIs are tied to `www.kubotics.ch` — check
  `azure-auth.service.ts` + the Entra app registration and add the H2 origin,
  e.g. `http://<h2-host>:8001/dashboard`, if sign-in is done there).
- If the local page is served on plain HTTP on a LAN IP, MSAL may reject the
  redirect (secure-context rules) — fallback plan: keep auth flow initiated
  against the public origin and only the data plane local (mode.json
  `authOrigin`). Do **not** disable auth for the local build.

## 4. Work breakdown (estimates are build+test time, no robot needed)

| # | Task | Files | Size |
|---|---|---|---|
| 1 | `DashboardConfig` service + `public/dashboard-mode.json` (default cloud) | new `core/services/dashboard-config.service.ts`, `public/` | ✅ done |
| 2 | Replace hardcoded `API_BASE` (dashboard, spend-control; legacy was relative already) | 2 files | ✅ done |
| 3 | Tab allowlist filter + `setTab` guard | `dashboard.ts` | ✅ done |
| 4 | Local overview variant (cloud blocks gated by `!isLocal()`) | `dashboard.ts` template | ✅ done |
| 5 | Config docs + cutover steps | this file | ✅ done |
| 6 | Tests: 404 fallback, h2 tab filter, trailing-slash trim, idempotent load | `dashboard-config.service.spec.ts` | ✅ done (41/41 suite green) |

Total: ~half a day, all verifiable **without the robot** (mode.json swapped
locally + `ng serve`). Robot-side validation when the H2 is on: sign-in round
trip, each local tab against the local API, offline/degraded behavior.

## 5. Cutover when the H2 is turned on

1. Build/commit lands like any frontend change (root `deploy-frontend.yml`).
2. On the H2: place `{"mode":"h2-local","apiBase":"http://localhost:<port>/api/v1"}` in the served `assets/` and restart `h2-web-host.service`.
3. Smoke checklist: Entra login → 13 local tabs only → Motion/Management
   controls answer → no investments/sessions/spend reachable → thermals LIVE
   → restart preserves mode.
4. Rollback: delete/rename the mode file (falls back to cloud defaults) or
   revert the single commit.

## 6. Decisions still needed from Vincent

1. Keep or replace the `overview` tab on the H2 (plan assumes a local status
   overview, cheapest reuse of existing telemetry).
2. Exact local API base/port of the H2 web host (checked when robot is up).
3. Whether Jcode Chat + RL Training tabs belong in the light build (they are
   local, but they are also dev-facing — default in the list above: in).
