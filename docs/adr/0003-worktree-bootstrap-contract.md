# ADR 0003: Worktree Bootstrap Contract

## Context

The repository uses Lefthook for commit hooks but previously treated linked-worktree readiness as an undocumented manual step. Root Bun dependencies, Web Bun dependencies, and the firmware, host-tools, and desktop Cargo caches can all be absent in a fresh linked worktree.

The repository also contains local hardware and environment state that must never be copied or overwritten by an onboarding hook. Git layouts with a separate worktree metadata directory and user-managed `core.hooksPath` must remain safe.

## Decision

Use Lefthook's shared `post-checkout` hook as the automatic entrypoint. The hook only invokes bootstrap for linked worktrees and branch checkouts. The bootstrap runs lockfile-pinned dependency recovery, records a digest marker in the worktree's Git metadata, and treats failures as warnings so checkout is not blocked.

Expose the same setup through `just worktree-bootstrap` with strict aggregate failure semantics. The setup never installs toolchains or browser runtimes and never touches `.env`, `.esp32-port`, ports, or hardware state. A real linked-worktree smoke test is a required `Repo Contracts / Worktree bootstrap` check.

## Consequences

- A fresh linked worktree can recover repository-managed dependencies without relying on a private checklist.
- Automatic checkout remains non-blocking, while maintainers have an explicit command that exposes every failed step.
- Dependency recovery may access package registries, but only through the repository's lockfiles and the already-installed local tools.
- A required CI check and live branch protection update must remain synchronized with `.github/quality-gates.json`.

## Alternatives considered

- Explicit setup only: rejected because it leaves the existing shared Lefthook surface unable to establish readiness automatically.
- A repo-local Lefthook Bun dependency: rejected because a new worktree can execute its first shared hook before `node_modules` exists, and the project already treats global Lefthook as the hook prerequisite.
