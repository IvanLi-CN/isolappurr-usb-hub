# Web Demo Surface Policy

## Background

The Web console uses three different owner-facing evidence surfaces today:

- the production SPA routes in `web/src/App.tsx`
- composite Storybook stories such as `Panels/DevicePowerPanel`
- spec-owned `## Visual Evidence` captures that point to stable mock-only or
  live evidence

This arrangement is useful only when each surface keeps a clear role.
Ad hoc demo pages or route/query toggles inside the production SPA make the Web
surface harder to reason about, and page-level Storybook stories blur the line
between route verification and component verification. The repository needs a
single policy that defines which Web demo surfaces are allowed and how future
exceptions are approved.

## Goals

- Preserve the production SPA routes as the only app-level owner-facing pages
  under `web/`.
- Preserve Storybook as a formal mock-only verification surface for reusable
  components and composite UI surfaces.
- Preserve spec `## Visual Evidence` blocks as the canonical place to bind
  owner-facing screenshots to a documented state.
- Prevent ad hoc Web demo routes, query toggles, and page-level Storybook
  stories from reappearing.

## Non-goals

- Rebuilding the existing Storybook architecture around smaller primitives.
- Replacing current `Panels/*`, `Layouts/*`, `Dialogs/*`, `Cards/*`, or similar
  composite verification stories.
- Changing product behavior, power semantics, hardware contracts, or transport
  APIs.
- Defining a blanket policy for non-Web preview systems such as firmware
  display previews.

## Requirements

- `demo surface` in this repository MUST mean only a temporary Web verification
  surface added under `web/` for a specific task or debugging need.
- The production SPA MUST NOT add dedicated demo routes such as `/demo/*`,
  query-driven demo entrypoints such as `?demo=*`, or equivalent ad hoc
  app-level route toggles.
- Storybook MUST remain the formal mock-only verification surface for reusable
  components and composite surfaces, including `Panels/*`, `Layouts/*`,
  `Dialogs/*`, and `Cards/*`.
- Storybook MUST NOT host page-level stories under `web/src/pages/*.stories.*`
  as the normal verification path for production routes.
- The production Web app MUST NOT add dedicated demo page components under
  `web/src/pages/*DemoPage.tsx`.
- Owner-facing screenshot evidence for Web UI changes MUST continue to bind to
  stable states through spec `## Visual Evidence` sections instead of informal
  chat-only route references.
- When a task needs route-level validation, it MUST use the production SPA page
  itself, an approved live HIL/browser path, or a spec-owned evidence capture;
  it MUST NOT add a dedicated demo page or route toggle.
- The repository MUST treat current production routes, composite Storybook
  stories, and spec-owned visual evidence as the only default allowed Web
  verification surfaces.
- The repository MUST ship with no active exception whitelist for Web demo
  pages or routes.
- Any future exception to the no-demo-page rule MUST be approved by updating a
  spec that names the exact surface, purpose, ownership boundary, and
  acceptance path before the implementation lands.
- Repository contract tests MUST fail if page-level Storybook stories under
  `web/src/pages/` are reintroduced.
- Repository contract tests MUST fail if production routing adds `/demo/`,
  `demo=`, or equivalent ad hoc demo entrypoints in `web/src/App.tsx`.

## Acceptance Criteria

- Given the repository after this policy lands, when the Web source tree is
  scanned, then no `web/src/pages/*.stories.*` files exist and no
  `web/src/pages/*DemoPage.tsx` files exist.
- Given the production Web router, when `web/src/App.tsx` is checked, then it
  contains no `/demo/` routes, `demo=` query toggles, or equivalent ad hoc
  demo entrypoints.
- Given Storybook coverage for the Web console, when maintainers add or update
  UI verification stories, then composite `Panels/*`, `Layouts/*`, `Dialogs/*`,
  or `Cards/*` stories remain allowed while page-level route stories remain
  disallowed.
- Given a Web task needs owner-facing visual evidence, when the final evidence
  is documented, then the capture is referenced from a spec `## Visual
  Evidence` section instead of an undocumented demo route.
- Given a future task proposes a Web demo page exception, when the repository
  is reviewed, then the exception is blocked unless a spec explicitly defines
  the surface, purpose, and acceptance boundary first.
