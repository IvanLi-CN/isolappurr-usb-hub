# Worktree Bootstrap

> This file is the durable linked-worktree readiness contract. Current implementation facts belong in `IMPLEMENTATION.md`; lifecycle history belongs in `HISTORY.md`.

## Context and Scope

- Context: A fresh linked worktree must become ready for repository development without depending on maintainer memory or touching owner-local hardware state.
- In scope: Lefthook `post-checkout` integration, lockfile-pinned dependency recovery, worktree-local readiness markers, explicit strict repair, safe Git-layout fallbacks, and the required smoke gate.
- Out of scope: hardware selection or flashing, port leases, environment/secrets synchronization, browser runtime installation, toolchain installation, product behavior, and release artifact construction.

## Terms and Interfaces

- `linked-worktree readiness`: the state in which the five repository-managed dependency surfaces have completed their locked recovery steps for the current manifest digest.
- `automatic bootstrap`: the `post-checkout` path that runs only for linked worktrees and returns success after reporting failures as warnings.
- `strict repair`: `just worktree-bootstrap`, which runs the same setup and returns an aggregate non-zero status when any step fails.
- `readiness marker`: a digest-named file under the current worktree's Git metadata; it is not a repository-tracked file.
- Interface: `lefthook.yml` `post-checkout`, `just worktree-bootstrap`, and `scripts/test-worktree-bootstrap.sh`.

## Requirements

### REQ-WTB-001

- The repository MUST provide one repo-owned linked-worktree bootstrap chain shared by automatic `post-checkout` and strict manual repair.
- Inputs: a Git linked worktree at a branch checkout and the repository's checked-in manifests and lockfiles.
- Outputs: the automatic path reports warnings and returns success; the strict path reports every failed step and returns non-zero.

### REQ-WTB-002

- The bootstrap MUST recover root Bun, Web Bun, firmware Cargo, host-tools Cargo, and desktop Cargo dependencies using frozen or locked manifests.
- Inputs: `bun.lock`, `web/bun.lock`, root `Cargo.lock`, `tools/isolapurr-host/Cargo.lock`, and `desktop/src-tauri/Cargo.lock`.
- Outputs: dependency directories/caches are ready for the current manifest digest.

### REQ-WTB-003

- The bootstrap MUST preserve owner-local state and MUST NOT install toolchains or browser runtimes.
- Inputs: existing `.env`, `.esp32-port`, custom `core.hooksPath`, ports, and hardware state.
- Outputs: those values remain unchanged and the hook safely skips unsupported or historical revisions.

### REQ-WTB-004

- The repository MUST verify the contract with a real linked-worktree smoke and expose it as `Repo Contracts / Worktree bootstrap` on `pull_request`, `merge_group`, and `main` runs.
- Inputs: a fresh temporary Git repository, the actual Lefthook binary, and fake Bun/Cargo executables for deterministic dependency calls.
- Outputs: first-run, repeat-run, historical-revision, failure, custom-hook, and preservation assertions pass.

## Verification

### VER-WTB-001

- Method: `bash scripts/test-worktree-bootstrap.sh`.
- covers: `REQ-WTB-001`, `REQ-WTB-002`, `REQ-WTB-003`, `REQ-WTB-004`.
- Pass condition: a real linked worktree runs all five steps once, skips the same digest on repeat, handles missing historical scripts safely, distinguishes automatic and strict failures, and preserves custom hooks and local state.

### VER-WTB-002

- Method: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .github/scripts -p "test_*.py"` plus the `Repo Contracts / Worktree bootstrap` GitHub job.
- covers: `REQ-WTB-004`.
- Pass condition: the exact required check is declared in `.github/quality-gates.json`, the workflow verifies the pinned Lefthook binary digest, and the workflow emits the declared check name.

## Related ADRs

- [ADR 0003: Worktree Bootstrap Contract](../../adr/0003-worktree-bootstrap-contract.md)

## Visual Evidence

- None

## References

- `./IMPLEMENTATION.md`
- `./HISTORY.md`
- `lefthook.yml`
- `scripts/worktree-bootstrap.sh`
- `scripts/test-worktree-bootstrap.sh`
