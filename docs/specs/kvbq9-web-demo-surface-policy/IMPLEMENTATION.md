# Web Demo Surface Policy Implementation

## Current Coverage

- The production SPA routes remain limited to the real console pages declared
  in `web/src/App.tsx`, and the same route tree now also supports the formal
  `?demo=true|false` session-scoped demo mode.
- The demo affordance is now one header-level control that opens a responsive
  panel: desktop uses a modal dialog, while mobile uses a bottom drawer/sheet.
- Composite Storybook surfaces remain under non-page namespaces such as
  `Panels/*`, `Layouts/*`, `Dialogs/*`, and `Cards/*`.
- The dedicated power preview demo page and its mock server were removed so the
  repo now only exposes the production SPA plus composite Storybook coverage.
- The formal demo mode reuses the production page/provider tree, mocks only the
  front-end API boundary for bootstrap/storage/discovery/device APIs, and keeps
  its canonical demo world in `sessionStorage`.
- Repository contract tests guard against these regressions:
  - reintroducing `web/src/pages/*.stories.*`
  - reintroducing `web/src/pages/*DemoPage.tsx`
  - adding `/demo/` or `demo=` style ad hoc demo entrypoints to
    `web/src/App.tsx`
- The existing page-level Storybook drift (`web/src/pages/AboutPage.stories.tsx`)
  is removed so the policy and the tree match immediately.
- README and maintainer workflow docs describe Storybook as a formal component /
  composite verification surface, while the production SPA demo mode is
  documented as the only owner-facing route-level demo surface.

## Validation

- `python3 -m unittest discover -s .github/scripts -p "test_*.py"`
- `cd web && bun run test:unit`
- `cd web && bun run build-storybook`

## Follow-up Candidates

- If future Web specs need extra scenario controls or richer error-state
  matrices beyond the canonical control panel, document that new surface in the
  owning spec before implementation and add a targeted contract test for the
  approved boundary.
- If additional route-level drift patterns appear outside `web/src/App.tsx`,
  expand the contract guard to cover the owning router module set explicitly.
