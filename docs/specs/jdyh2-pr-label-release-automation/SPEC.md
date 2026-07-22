# PR Label Driven Automatic Release（#jdyh2）

> 当前有效规范以本文为准；实现覆盖与当前状态见 `./IMPLEMENTATION.md`，关键演进原因见 `./HISTORY.md`。

## 背景 / 问题陈述

- 现状：PR label 已经能表达发布意图，但 stable release、默认 GitHub Pages 公开面和 required checks 曾经分散在多条 workflow 里，彼此没有单源合同。
- 问题：一旦 stable 版本发布、Pages 部署、PWA owner-facing 站点或 required checks 命名任一链路漂移，就会出现“release 发了但默认站点没切”“Pages 被非 stable 覆盖”“branch protection/check 名称对不上”的维护事故。
- 如果没有这份 spec，发布契约会继续散落在 `.github/workflows/release.yml`、`.github/workflows/pages.yml`、`.github/quality-gates.json` 和仓库设置里，后续很容易再次回到半发布状态。

## 目标 / 非目标

### Goals

- 使用 PR label 作为唯一的 release intent contract，并在 PR 阶段提供可信 Label Gate。
- 把 stable 发布路径固定为：`resolve intent -> create/update draft release -> build once -> upload assets -> deploy Pages from the same web artifact -> publish release`。
- 让默认 GitHub Pages 公开面只由 stable 路径更新；`channel:dev` 继续发布 prerelease 与资产，但绝不覆盖默认 owner-facing 站点。
- 把 required checks、workflow job 名称、merge queue 可见性和仓库 branch protection contract 对齐到同一份 `quality-gates` truth source。
- 保留 manual backfill 能力，但只允许按 `release_tag` 重放既有 stable web asset，不允许同一 SHA 二次重建 public site。

### Non-goals

- 不引入多组件独立版本，也不在发布时改写 Cargo、Tauri 或 Web manifest 版本。
- 不新增固定 preview 子域名、第二套 owner-facing 公开站点或独立 demo 部署面。
- 不把 component labels 作为选择性构建开关。
- 不跨仓自动修补外部 release/hosting 流程。

## 范围（Scope）

### In scope

- `.github/quality-gates.json`
- `.github/workflows/label-gate.yml`
- `.github/workflows/release.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/repo-contracts.yml`
- release intent/version resolver scripts and tests
- release asset packaging, installer assets, checksum/manifest generation
- stable/public-site contract docs and required-check truth sources

### Out of scope

- package signing beyond current macOS ad-hoc signing
- hardware flashing validation
- extra preview hosting surfaces or merge queue enablement itself

## 需求（Requirements）

### MUST

- PR labels must include exactly one `type:major | type:minor | type:patch | type:none`.
- PR labels must include exactly one `channel:stable | channel:dev`.
- Unknown reserved labels with `type:`, `channel:`, or `component:` prefixes must fail Label Gate.
- `type:none` must pass Label Gate but skip release publication.
- Stable releases must use normal SemVer tags and GitHub releases.
- Dev releases must use SemVer prerelease tags such as `v0.2.0-dev.1` and GitHub prereleases.
- Stable release reruns for the same `target_sha` must reuse the existing draft release/version instead of silently bumping a new tag.
- Stable release builds must build public `web/dist` exactly once per release run; the same build output must feed both the release asset archive and the default Pages deploy.
- Stable release publication must remain draft until the Pages deploy succeeds.
- `channel:dev` may publish prerelease assets, but it must never update the default owner-facing Pages site.
- `workflow_dispatch(release_tag=...)` on the Pages workflow must deploy from an existing stable release web asset and must not rebuild `web/dist`.
- Required checks must use a unique, stable name set:
  - `Label Gate`
  - `CI / Web (quality gates)`
  - `CI / Rust fmt`
  - `Firmware (ESP32-S3) / build`
  - `Host tools / linux-x86_64`
  - `Host tools / macos-aarch64`
  - `Host tools / windows-x86_64`
  - `Desktop / web dist`
  - `Desktop / macos`
  - `Desktop / windows`
  - `Desktop / linux`
  - `Pages / PR build`
  - `Repo Contracts / Python contract tests`
- Required PR workflows must trigger on both `pull_request` and `merge_group`; they must not rely on top-level `paths` / `paths-ignore` filters to decide whether the required check exists.
- Failure notification must call `IvanLi-CN/github-workflows/.github/workflows/release-failure-telegram.yml@main`.

### SHOULD

- Component labels should remain audit metadata only.
- Release notes should continue to state desktop signing limitations.
- Contract tests should pin the release/pages/required-check naming truth so drift fails fast in CI.

## 功能与行为规格（Functional/Behavior Spec）

### Stable release path

- When a `channel:stable` PR merge reaches `main`, the Release workflow resolves release intent, target SHA, and version.
- Before any stable artifact build starts, the workflow creates or reuses a draft GitHub Release for the resolved stable tag.
- The workflow builds host tools, firmware, desktop assets, and a single public `web/dist`.
- During the stable public web build, hashed-asset retention uses existing stable GitHub Release web-dist assets as the prior-release source.
- The same `web/dist` is packaged as the stable web release asset archive and uploaded as the Pages deploy artifact.
- Release assets are uploaded while the release remains draft.
- Only after the Pages deploy succeeds may the workflow publish the stable GitHub Release.

### Dev release path

- `channel:dev` uses the same release intent/asset pipeline, but produces a prerelease and never updates the default Pages site.

### Pages path

- `pages.yml` on `pull_request` / `merge_group` provides a stable PR build check only.
- `pages.yml` on `workflow_dispatch(release_tag=...)` performs stable backfill by downloading the matching web release asset and deploying it to Pages.
- The Pages workflow must not rebuild web assets during backfill.

### Required checks / repository protection path

- `.github/quality-gates.json` is the canonical required-check declaration.
- Workflow names, job names, and repository protection must align to the same required check list.
- Required workflows may internally skip heavy work when the PR surface is irrelevant, but they must still produce the required check contexts on `pull_request` and `merge_group`.

## 验收标准（Acceptance Criteria）

- Given a PR with `type:minor` and `channel:stable`
  When Label Gate runs
  Then it passes and resolves release intent as a release.

- Given a PR created before its labels are durably visible in the initial `opened` event payload
  When Label Gate validates the PR
  Then it reads the current live PR labels instead of trusting the stale event snapshot.

- Given existing releases `v0.1.0`
  When a `type:minor` stable release is resolved
  Then the next tag is `v0.2.0`.

- Given an existing draft stable release for the same `target_sha`
  When the stable release workflow reruns
  Then it reuses the same tag/draft release instead of bumping a new stable version.

- Given a stable release run
  When `web/dist` is built
  Then that single build output feeds both the GitHub Release web asset archive and the default Pages deploy.

- Given a previous stable release is still inside the hashed-asset retention window
  When the next stable public web build runs
  Then its retention step restores the old hash assets from the previous stable GitHub Release web-dist asset instead of rebuilding or trusting the current live Pages manifest as the only history source.

- Given a stable release run
  When Pages deploy fails
  Then the GitHub Release remains draft and is not published half-way.

- Given `workflow_dispatch(release_tag=<stable-tag>)` on Pages
  When the workflow runs
  Then it downloads the existing web release asset and deploys it without rebuilding.

- Given `channel:dev`
  When the release workflow runs
  Then it publishes a prerelease with assets but does not change the default Pages site.

- Given a PR or merge queue run
  When required checks are listed
  Then the stable required-check set appears with the exact names declared in `.github/quality-gates.json`.

## Milestones

- [x] Release label policy and Label Gate added.
- [x] Central release intent/version scripts and tests added.
- [x] Central Release workflow added.
- [x] Stable release and default Pages deploy unified onto one single-build contract.
- [x] Pages PR build and stable backfill paths split into dedicated contracts.
- [x] Required checks, merge_group visibility, and quality-gates truth source aligned.

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .github/scripts -p "test_*.py"`

### Release / workflow

- `.github/workflows/release.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/repo-contracts.yml`
- `.github/quality-gates.json`

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：GitHub repository protection 是仓库运行时状态；如果 live settings 没按本 spec 对齐，再正确的 workflow 命名也可能无法真正保护 `main`。
- 风险：stable Pages deploy 仍依赖 GitHub Pages 基础设施；若 GitHub Pages 环节失败，stable release 会故意停留在 draft，维护者必须显式处理该失败。
- 假设：default owner-facing public site 继续使用当前 GitHub Pages target，不新增第二套 stable 公开面。

## 参考（References）

- `.github/quality-gates.json`
- `.github/workflows/label-gate.yml`
- `.github/workflows/release.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/repo-contracts.yml`
- `.github/scripts/release_intent.py`
- `.github/scripts/test_release_intent.py`
- `.github/scripts/test_quality_gates_contract.py`
- `.github/scripts/test_release_pages_contracts.py`
- `README.md`
- `docs/maintainer-workflow.md`
