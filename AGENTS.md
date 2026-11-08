# Antigravity Guidelines

## Task Tracking
- Use `bd` (Beads) for progression tracking and task management.
- bd available in c:\coding\Websites\bd.exe
- Initialize with `bd init` if not already done.
- Follow the hierarchy: `bd ready` to see what to do next.

## UI Design
- Use the `ui-ux-pro-max` skill for all UI/UX design intelligence.
- Preferred styles: Professional, modern, and high-performance.
- Fonts and Icons MUST be from [Google Fonts](https://fonts.google.com/) and [Google Material Icons](https://fonts.google.com/icons).
- Avoid third-party UI libraries unless specified.

## Angular Development
- Framework: **Angular 21** (Latest unstable/experimental features if available, otherwise latest stable).
- Architecture: Modern Angular syntax (Signals, Standalone Components, Functional Interceptors).
- Style: SCSS or Vanilla CSS (standard for the project).
- Backend: Limit to static or minimal serverless functions.
- Avoid unnecessary plugins/dependencies.

## Workflows
- Always check `.agent/workflows` for specific project steps.

## CI / GitHub Actions
- **Only `.github/workflows/` at the REPO ROOT executes.** Workflow files in
  subdirectories (e.g. `Kubotics-Backend/.github/workflows/deploy.yml`) are
  silently ignored by GitHub — edit the root pipeline, never a nested copy.
  (2026-11-08 incident: MIMO/XAI secret mapping + the pytest gate sat in a
  dead nested file for hours while the live pipeline ran without them; see
  `Kubotics-Backend/docs/KUBOT_MAIL_AGENT_PLAN.md` §7.4/6. The live pipeline
  `/.github/workflows/deploy.yml` gates every deploy with
  `uv run --frozen pytest -q` — keep that gate green before pushing.)
