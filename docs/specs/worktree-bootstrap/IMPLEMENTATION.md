# Worktree Bootstrap 实现状态

> 当前有效规范仍以 `./SPEC.md` 为准；这里记录实现覆盖、验证与 rollout 事实。

## Current Status

- Implementation: 已实现
- Lifecycle: active
- Catalog note: Lefthook linked-worktree recovery with required smoke coverage

## Implementation Coverage

- `REQ-WTB-001`: `lefthook.yml`, `scripts/run-lefthook-hook.sh`, `scripts/worktree-bootstrap.sh`, and `just worktree-bootstrap` share one setup chain.
- `REQ-WTB-002`: `scripts/worktree-bootstrap.sh` recovers root/Web Bun and the three Cargo manifests with frozen or locked commands.
- `REQ-WTB-003`: linked-only detection, digest markers in Git metadata, per-worktree locking, cached Cargo metadata checks, warning/strict failure modes, historical no-op behavior, and local-state preservation are covered by the smoke fixture.
- `REQ-WTB-004`: `.github/workflows/repo-contracts.yml` runs the real smoke with verified Lefthook `v2.1.14`; `.github/quality-gates.json` declares the required context.

## Verification Commands

- `bash scripts/test-worktree-bootstrap.sh`
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .github/scripts -p "test_*.py"`
- `lefthook validate`

## Rollout Facts

- The automatic hook is best-effort and does not block checkout. `just worktree-bootstrap` is the strict repair path.
- GitHub `main` branch protection must add `Repo Contracts / Worktree bootstrap` only after a merged `main` run has emitted the new check; the rollout must preserve all existing protection settings.

## Remaining Gaps

- None in the repository contract. Live branch protection synchronization is a post-merge rollout action.

## Related Changes

- `./SPEC.md`
- `./HISTORY.md`

## References

- `./SPEC.md`
- `./HISTORY.md`
