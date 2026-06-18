# Web Demo Surface Policy History

## 2026-06-18

- Flipped the repository-level Web demo-surface policy from “no `demo=` at
  all” to “allow only the formal production SPA `?demo=true|false` contract.”
- Locked v1 demo mode to one canonical session-backed world that reuses the
  production route tree and page/provider logic while mocking only the API
  boundary.
- Kept `/demo/*` pages and `web/src/pages/*.stories.*` forbidden, and updated
  repo contract coverage so uncontrolled demo entrypoints cannot quietly
  return.
