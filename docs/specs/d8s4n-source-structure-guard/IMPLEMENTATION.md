# Source Structure Guard Implementation

## Current Coverage

- `scripts/check_source_lengths.py` scans project source files, reports `>800` line warnings, and fails `>1200` line hand-written files.
- `just source-lengths` provides the local entrypoint.
- `.github/workflows/ci.yml` runs the guard as a PR CI job.
- Generated dashboard font data is allowlisted through `src/display_ui/dashboard_font.rs` and its `@generated` marker.
- Oversized desktop, host-tool, firmware network, firmware entry, and Web dialog sources are split into smaller responsibility files without behavior changes.

## Validation

- `python3 scripts/check_source_lengths.py`
- `cargo +stable fmt --all -- --check`
- `cargo +stable test --manifest-path tools/isolapurr-host/Cargo.toml --target <host>`
- `cd desktop/src-tauri && cargo +stable test --target <host>` after generating `desktop/dist`
- `cd web && bun run check`

## Follow-up Candidates

- Convert Rust `include!` fragments into regular modules where parameter surfaces stay manageable.
- Reduce warning-level files below `800` lines as those areas are touched.
