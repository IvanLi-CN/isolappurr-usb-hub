# PR Label Driven Automatic Release 实现状态（#jdyh2）

> 当前有效规范仍以 `./SPEC.md` 为准；这里记录实现覆盖、交付进度与 rollout 相关事实，避免这些细节散落到 PR / Git 历史里。

## Current Status

- Implementation: 已实现
- Lifecycle: active
- Catalog note: single-source stable release, stable-only public Pages deploy, release-asset backfill, and aligned required-check naming

## Coverage / rollout summary

- `.github/workflows/release.yml` 现在把 stable 发布固定为“解析意图 -> 准备 draft -> 单次构建 -> 上传资产 -> 部署 Pages -> 发布 release”。
- stable/dev release shell 校验现在由 `.github/scripts/release_workflow.py` 承担，避免 `release.yml` 在条件分支中因为 heredoc 解析失败而把整条发布链路短路。
- `.github/workflows/pages.yml` 现在只承担 PR build check 与 `release_tag` backfill；默认公开 Pages 面不再由普通 `push main` 直接覆盖。
- `.github/scripts/release_intent.py` 现在会按 `target_sha` 复用既有 stable draft / dev prerelease 版本，避免 rerun 时静默 bump 新 tag。
- `.github/quality-gates.json` 现在是 required checks 的单一 truth source，并显式声明 `pull_request + merge_group` required-check contract。
- `.github/workflows/repo-contracts.yml` 与 Python contract tests 现在锁住 Pages/release/quality-gates contract，防止 workflow 名称与触发策略再漂移。
- GitHub `main` branch protection 现在已经按同一份 required-check contract 启用，并要求 PR 合并、signed commits、strict status checks、禁用 force-push 与 branch deletion。

## Remaining Gaps

- 当前没有已知实现缺口；后续若 required checks 集合变动，必须同时更新 `.github/quality-gates.json`、对应 workflow/job 名称与 GitHub live branch protection。

## Related Changes

- `.github/quality-gates.json`
- `.github/workflows/label-gate.yml`
- `.github/workflows/release.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/repo-contracts.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/host-tools.yml`
- `.github/workflows/desktop.yml`
- `.github/workflows/firmware.yml`
- `.github/scripts/release_intent.py`
- `.github/scripts/release_workflow.py`
- `.github/scripts/test_release_intent.py`
- `.github/scripts/test_release_workflow.py`
- `.github/scripts/test_quality_gates_contract.py`
- `.github/scripts/test_release_pages_contracts.py`

## References

- `./SPEC.md`
- `./HISTORY.md`
