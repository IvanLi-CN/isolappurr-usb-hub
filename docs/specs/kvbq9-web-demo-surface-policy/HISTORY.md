# Web Demo Surface Policy History

## 2026-06-18

- Created a repository-level Web demo-surface policy instead of chasing an
  already-removed power-specific demo route.
- Locked the default allowed Web verification surfaces to production SPA pages,
  composite Storybook stories, and spec-owned `## Visual Evidence`.
- Removed the existing page-level Storybook drift at
  `web/src/pages/AboutPage.stories.tsx`.
- Added repo contract coverage so page-level stories and ad hoc demo routes do
  not quietly return.

## 2026-06-18

- Tightened the no-demo-page rule so dedicated `web/src/pages/*DemoPage.tsx`
  components are treated as the same policy violation as ad hoc `/demo/*`
  routes or `?demo=*` toggles.
- Removed the transient Power preview demo implementation and its mock server
  so the power topic again relies only on the production route, composite
  Storybook stories, and spec-owned visual evidence.
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
