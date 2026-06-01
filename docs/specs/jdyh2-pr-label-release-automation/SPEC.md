# PR Label Driven Automatic Release

Status: 已完成
Last: 2026-06-01

## 背景 / 问题陈述

项目发布曾依赖 tag push。普通 PR 合并后不会自动创建 GitHub Release，也不会把 host tools、firmware、desktop、web 的产物绑定到同一个产品版本。发布意图需要在 PR 阶段显式声明，并在合并后由可信的主干 workflow 统一执行。

## 目标 / 非目标

目标：

- 使用 PR label 作为发布意图契约，并在 PR 阶段提供可信 Label Gate。
- PR 合并到 `main` 后，由集中 `Release` workflow 解析关联 PR、计算版本、构建全量资产并发布 GitHub Release。
- 采用单一产品 SemVer，不在发布时改写 Cargo、Tauri 或 Web package manifest 版本。
- 为 host tools、firmware、desktop runtime、web build 注入发布版本。
- 保留组件 workflow 的 PR/主干检查面，把 tag-only 发布逻辑移出组件 workflow。
- 提供 release failure Telegram notifier caller，并要求 `SHOUTRRR_URL` 缺失时失败。

非目标：

- 不在本仓代码改动中创建 GitHub labels、branch protection、required checks 或 secrets。
- 不引入多组件独立版本。
- 不把 component labels 作为选择性构建开关。

## 范围

In scope:

- `.github/quality-gates.json`
- `.github/workflows/label-gate.yml`
- `.github/workflows/release.yml`
- `.github/workflows/notify-release-failure.yml`
- release intent/version resolver scripts and tests
- version override helpers in firmware, host tools, desktop runtime, and web build display
- removal of tag-only host tools release publication

Out of scope:

- GitHub repository settings alignment after this PR merges
- package signing beyond current macOS ad-hoc signing
- hardware flashing validation

## 需求列表

MUST:

- PR labels must include exactly one `type:major | type:minor | type:patch | type:none`.
- PR labels must include exactly one `channel:stable | channel:dev`.
- Unknown reserved labels with `type:`, `channel:`, or `component:` prefixes must fail Label Gate.
- `type:none` must pass Label Gate but skip release publication.
- Stable releases must use normal SemVer tags and GitHub releases.
- Dev releases must use SemVer prerelease tags such as `v0.2.0-dev.1` and GitHub prereleases.
- The first stable release must resolve to `v0.1.0`.
- Release builds must publish host tools, installer scripts, firmware catalog/payloads, desktop packages, web dist archive, `release-intent.json`, an asset manifest, and SHA256 checksums.
- Release workflow must not mutate manifest versions.
- Failure notification must call `IvanLi-CN/github-workflows/.github/workflows/release-failure-telegram.yml@main`.

SHOULD:

- Component labels should remain audit metadata only.
- Release notes should state desktop signing limitations.
- Scripts should be locally unit-testable.

## 验收标准

Given a PR with `type:minor` and `channel:stable`, when Label Gate runs, then it passes and resolves release intent as a release.

Given a PR missing either required label family, when Label Gate runs, then it fails with a clear error.

Given existing releases `v0.1.0`, when a `type:minor` stable release is resolved, then the next tag is `v0.2.0`.

Given existing releases `v0.1.0` and `v0.2.0-dev.1`, when a `type:minor` dev release is resolved, then the next tag is `v0.2.0-dev.2`.

Given `type:none` and a valid channel, when a merge reaches the Release workflow, then release jobs are skipped after intent resolution.

Given `ISOLAPURR_RELEASE_VERSION=0.2.0-dev.1`, when host tools, firmware, or desktop runtime report their app version, then the release version is used instead of the manifest version.

## Milestones

- [x] Release label policy and Label Gate added.
- [x] Central release intent/version scripts and tests added.
- [x] Central Release workflow added.
- [x] Failure notifier caller added.
- [x] Manifest-free version injection added.
- [x] Component workflow tag publication removed.

## 风险与开放问题

- GitHub-side labels, required checks, signed-commit policy, PR-only `main`, and `SHOUTRRR_URL` must be configured after merge.
- Tauri package metadata still reads from checked-in config unless future packaging work adds a supported config override; runtime API/CLI version uses the release override.
