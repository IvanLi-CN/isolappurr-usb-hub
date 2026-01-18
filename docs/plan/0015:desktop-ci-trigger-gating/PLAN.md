# Desktop：CI 触发去重（Plan 0015）

## 状态

- Status: 已完成
- Created: 2026-01-18
- Last: 2026-01-18

## 背景 / 问题陈述

在同一 PR 的同一提交上，`desktop` workflow 可能同时被 `push` 与 `pull_request` 触发，造成重复构建与重复检查（尤其是跨平台矩阵），浪费时间与资源、拉长反馈周期。

## 目标 / 非目标

### Goals

- PR 场景：desktop workflow **只跑一套**（仅 `pull_request` 触发），不再出现同一提交对应的 `push` run。
- 非主分支（feature branch）`push`：不构建 desktop（除非通过手动触发）。
- 主干/发布场景：`main`、`release/*`、tags 的 `push` 仍构建 desktop。
- fork PR：不运行 desktop workflow。
- 保留 `workflow_dispatch` 作为人工排查入口。

### Non-goals

- 不做构建提速（缓存/复用/并行优化）与矩阵裁剪（另行计划）。
- 不改变现有 desktop 的 lint/build/smoke 口径与产物格式。
- 不调整仓库分支保护策略（仅在风险里提示可能影响）。

## 用户与场景

- 维护者在 PR 中需要快速确认 desktop 跨平台构建与 smoke 的健康度。
- 维护者在 `main`/`release/*` 或 tags 上需要得到合并后/发布前的完整构建结果。
- 维护者希望 feature branch 的频繁 `push` 不触发重型 desktop 构建。

## 需求（Requirements）

### MUST

- 同一提交在 PR 场景不得同时出现 `push` 与 `pull_request` 的 desktop workflow run。
- 非 `main` / 非 `release/*` 的分支 `push` 不运行 desktop workflow。
- `main` / `release/*` / tags 的 `push` 必须运行 desktop workflow。
- PR 来自 fork 仓库时，desktop workflow 不运行。
- 保留 `workflow_dispatch` 手动触发。
- 不降低现有 desktop 的检查范围（lint/build/smoke 仍按既有 workflow 执行）。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub Actions workflow: desktop.yml | File format | internal | Modify | ./contracts/file-formats.md | CI | Maintainers, GitHub Actions | 触发条件与执行条件 |

### 契约文档（按 Kind 拆分）

- [contracts/file-formats.md](./contracts/file-formats.md)

## 约束与风险

- fork PR 不运行 desktop workflow：若将 desktop 相关检查设置为“必需检查（required checks）”，则 fork PR 可能因检查缺失/被跳过而无法合并，需要维护者在 GitHub 设置侧调整策略。
- tags 的命名策略不在本计划范围：默认认为 tags 用于发布/构建验证，因此需要触发 desktop workflow。

## 验收标准（Acceptance Criteria）

- Given 同仓库分支发起 PR（目标分支为 `main`）
  When 在该 PR 分支 `push` 新提交
  Then desktop workflow 仅应有 `pull_request` 触发的 run；不应同时出现该提交对应的 `push` run
- Given 非 `main` 且非 `release/*` 的分支
  When `push` 新提交
  Then desktop workflow 不运行
- Given `main` 分支 `push` 新提交（例如合并 PR）
  When desktop workflow 运行
  Then workflow 按既有口径执行并通过（lint/build/smoke）
- Given `release/*` 分支或任意 tag 发生 `push`
  When desktop workflow 运行
  Then workflow 按既有口径执行并通过（lint/build/smoke）
- Given PR 来自 fork 仓库
  When PR 打开或更新
  Then desktop workflow 不运行（不产生 desktop 相关 build job）

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests: 不新增（保持现有 CI 口径）
- Integration tests: 不新增
- E2E tests (if applicable): 不新增（保持 desktop smoke）

### Quality checks

- 保持 `desktop.yml` 中既有 lint/build/smoke 检查不降级

## 文档更新（Docs to Update）

- `docs/plan/README.md`: 索引新增 Plan 0015
- `docs/plan/0015:desktop-ci-trigger-gating/PLAN.md`: 本计划
- `docs/plan/0015:desktop-ci-trigger-gating/contracts/file-formats.md`: workflow 契约

## 实现里程碑（Milestones）

- [x] M1: 调整 `desktop.yml` 的 `push` 触发范围（仅 `main` / `release/*` / tags）
- [x] M2: `pull_request` 场景加入 fork PR 跳过规则
- [x] M3: 回归验证触发行为（非主分支 push/PR/main push/release push/tag push）

## 假设（Assumptions）

- 仓库当前不依赖“fork PR 必须跑 desktop”的协作模式；fork PR 跳过不会影响主流程。
