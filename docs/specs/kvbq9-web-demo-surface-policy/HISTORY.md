# Web Demo Surface Policy History

## 2026-06-18

- Flipped the repository-level Web demo-surface policy from “no `demo=` at
  all” to “allow only the formal production SPA `?demo=true|false` contract.”
- Locked v1 demo mode to one canonical session-backed world that reuses the
  production route tree and page/provider logic while mocking only the API
  boundary.
- Added a single header-level demo control panel for that canonical world,
  rendered as a desktop modal and a mobile drawer/sheet without introducing
  any extra demo route or scenario selector.
- Kept `/demo/*` pages and `web/src/pages/*.stories.*` forbidden, and updated
  repo contract coverage so uncontrolled demo entrypoints cannot quietly
  return.
