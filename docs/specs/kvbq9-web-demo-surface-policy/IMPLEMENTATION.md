# Web Demo Surface Policy Implementation

## Current Coverage

- The production SPA routes remain limited to the real console pages declared
  in `web/src/App.tsx`, and the same route tree now also supports the formal
  `?demo=true|false` session-scoped demo mode.
- Composite Storybook surfaces remain under non-page namespaces such as
  `Panels/*`, `Layouts/*`, `Dialogs/*`, and `Cards/*`.
- The formal demo mode reuses the production page/provider tree, mocks only the
  front-end API boundary for bootstrap/storage/discovery/device APIs, and keeps
  its canonical demo world in `sessionStorage`.
- Repository contract tests guard against three regressions:
  - reintroducing `web/src/pages/*.stories.*`
  - adding `/demo/*` style dedicated pages
  - adding uncontrolled `demo` entrypoints to `web/src/App.tsx`
- README and maintainer workflow docs describe Storybook as a formal component /
  composite verification surface, while the production SPA demo mode is
  documented as the only owner-facing route-level demo surface.

## Validation

- `python3 -m unittest discover -s .github/scripts -p "test_*.py"`
- `cd web && bun run test:unit`
- `cd web && bun run build-storybook`

## Follow-up Candidates

- If future Web specs need extra scenario controls, richer error-state matrices,
  or a demo control panel, document that new surface in the owning spec before
  implementation and add a targeted contract test for the approved boundary.
- If additional route-level drift patterns appear outside `web/src/App.tsx`,
  expand the contract guard to cover the owning router module set explicitly.
