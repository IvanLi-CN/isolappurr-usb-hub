# Web Demo Surface Policy Implementation

## Current Coverage

- The production SPA routes remain limited to the real console pages declared
  in `web/src/App.tsx`.
- Composite Storybook surfaces remain under non-page namespaces such as
  `Panels/*`, `Layouts/*`, `Dialogs/*`, and `Cards/*`.
- Repository contract tests guard against two regressions:
  - reintroducing `web/src/pages/*.stories.*`
  - adding `/demo/` or `demo=` style ad hoc demo entrypoints to
    `web/src/App.tsx`
- The existing page-level Storybook drift (`web/src/pages/AboutPage.stories.tsx`)
  is removed so the policy and the tree match immediately.
- README and maintainer workflow docs describe Storybook as a formal component /
  composite verification surface rather than an open-ended page demo area.

## Validation

- `python3 -m unittest discover -s .github/scripts -p "test_*.py"`
- `cd web && bun run build-storybook`

## Follow-up Candidates

- If future Web specs need an exception surface, document it in that topic spec
  before implementation and add a targeted contract test for the approved
  boundary.
- If additional route-level drift patterns appear outside `web/src/App.tsx`,
  expand the contract guard to cover the owning router module set explicitly.
