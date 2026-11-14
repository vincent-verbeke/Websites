# Light H2 dashboard — implementation plan (2026-11-14)

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

1. Add `assets/dashboard-mode.json`:
   ```json
   { "mode": "cloud", "apiBase": "https://api.kubotics.ch/api/v1" }
   ```
   The H2 copy ships `{"mode": "h2-local", "apiBase": "http://localhost:8001/api/v1"}` (edge/robot web host — confirm the exact local port when the
   H2 is up; `h2-web-host.service` + `edge_app` port 8001 are the candidates).
2. Introduce an injectable `DashboardConfig` service (providedIn root) that
   fetches the JSON once at bootstrap and exposes `mode()`, `apiBase()`,
   `isLocal()` signals. Replace every hardcoded `API_BASE` with it
   (`dashboard.ts`, `spend-control.component.ts`, legacy `core/api.ts`).
3. **Tab allowlist per mode** (single source, in that service):
   ```ts
   CLOUD_TABS = all 16
   H2_TABS    = ['twin','services','system','management','lidar','motion',
                 'vision','voice','chat','ha','training','ollama','software']
   ```
   Tabs are rendered from `tabs.filter(t => allowed().includes(t.id))`;
   unknown tab ids in the URL redirect to the first allowed tab (so a stale
   `/dashboard?tab=investments` link on the H2 cannot show an empty shell).
4. `overview` on H2 mode: either hide it, or (preferred, small change) render
   a **local status overview** = device online/offline, thermals headline,
   active services — reusing the existing `robot_h2_state` telemetry fetch
   instead of the cloud KPI/leads/spend signals.
5. Views `selectedView ∈ {'leads','conversations','spend'}` are cloud-only:
   never settable in H2 mode (`spend-control` behind `!isLocal()`).

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
| 1 | `DashboardConfig` service + `assets/dashboard-mode.json` (default cloud) | new `core/services/dashboard-config.ts`, `src/assets/` | S |
| 2 | Replace hardcoded `API_BASE` (dashboard, spend-control, legacy api) | 3 files | S |
| 3 | Tab allowlist filter + deep-link guard | `dashboard.ts` (~40 lines) | S |
| 4 | Local overview variant (drop leads/conversations/spend views when `isLocal()`) | `dashboard.ts` template + `spend-control` gate | M |
| 5 | Config docs: how to drop the H2 file in place + port confirmation | `H2_LIGHT_DASHBOARD_PLAN.md` §5 | S |
| 6 | Tests: mode file parse, tab filter, guard for unknown tab, `npm run build` green | new spec + CI | S |

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
