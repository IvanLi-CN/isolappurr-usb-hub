# Source Structure Guard

## Background

The repository contains firmware, desktop, host-tool, and Web UI code. Large hand-written source files make reviews slow, increase merge risk, and hide unrelated responsibilities in single files. Generated data files, such as rasterized display font tables, are a different category and should not drive manual code structure.

## Goals

- Keep hand-written source files below a hard size budget so future work remains reviewable.
- Report files above the maintenance warning threshold without blocking work immediately.
- Allow explicitly generated source artifacts when they are marked or allowlisted.
- Preserve existing firmware, desktop, host-tool, and Web UI behavior while splitting oversized sources.

## Non-goals

- No runtime behavior, API, protocol, CLI, visual design, or hardware-operation change.
- No generated data rewrite for `src/display_ui/dashboard_font.rs`.
- No broad dependency upgrade or formatter policy change beyond the source length guard.

## Requirements

- Hand-written source files MUST fail the guard when they exceed `1200` lines.
- Hand-written source files SHOULD be reported when they exceed `800` lines.
- Generated source files MAY exceed the hard line budget when they are marked with `@generated` near the top or explicitly allowlisted.
- The guard MUST ignore dependency, build, lock, vendor, hardware, and generated output directories.
- The guard MUST be runnable locally through `just source-lengths` and in CI through the main PR workflow.
- Refactors made to satisfy the guard MUST preserve existing public behavior and tests.

## Acceptance Criteria

- `python3 scripts/check_source_lengths.py` exits successfully with no failures.
- The CI workflow runs the source length guard for pull requests.
- Current oversized hand-written files are split below `1200` lines.
- Existing validation for Web UI, host tools, desktop agent, and firmware remains green or any environment blocker is explicitly documented.

## Risks

- Same-module `include!` fragments are low-risk for behavior preservation but are less strict than fully isolated modules.
- Future cleanup can convert include fragments into stronger Rust module boundaries once behavior coverage is sufficient.
