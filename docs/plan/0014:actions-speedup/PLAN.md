# GitHub Actions 构建提速与分拆（#0014）

## 状态

- Status: 待实现
- Created: 2026-01-17
- Last: 2026-01-17

## 背景 / 问题陈述

- 近期 PR 的 GitHub Actions 反馈变慢，影响迭代节奏。
- 最近一次 desktop workflow 的总体 wall time 约 17 分钟，主要耗时集中在 `tauri-cli` 安装与 desktop build；web build 仅数十秒。
- 该次运行排队时间几乎为 0，慢主要来自构建阶段，而非等待 runner。

## 目标 / 非目标

### Goals

- 缩短 PR 的反馈时间，优先降低 desktop workflow 的触发频率或单次耗时。
- 在不降低现有质量门槛的前提下，减少不必要的跨平台构建。
- 形成可执行的优化清单与可验证的验收指标。
- desktop workflow 在 PR 场景的 wall time 目标为 **≤ 10 分钟**。

### Non-goals

- 不更换 CI 平台或引入自建/付费 runner。
- 不调整产品功能或桌面/固件/前端的实现逻辑。
- 不改变发布产物格式与当前 smoke 口径。

## 用户与场景

- 维护者在 PR 中需要快速确认基本健康度（lint/build/smoke）。
- 合并到 main 前需要完整的跨平台构建与 smoke 覆盖。
- Web-only 或 docs-only 变更希望跳过 desktop 全量构建。

## 范围（Scope）

### In scope

- `.github/workflows/desktop.yml` 的触发条件、矩阵策略与缓存/产物复用。
- `.github/workflows/ci.yml` / `.github/workflows/pages.yml` 的触发与依赖关系（如需要拆分 web build）。
- `web-dist` artifact 的生成与复用策略统一。

### Out of scope

- 调整 Tauri/Rust/Bun 版本或升级运行时依赖。
- 改写 desktop build 流程或应用构建产物格式。
- 引入外部 CI 服务或自建 runner。

## 需求（Requirements）

### MUST

- 记录并复核当前 workflow 的基线耗时与主要瓶颈步骤。
- 在 PR 场景对 desktop workflow 做可控减负（路径过滤或条件运行）。
- 保持 main 合并前的质量门槛（lint/build/smoke 不降级）。
- 提供可验证的优化目标与回退策略。
- desktop 版本的 web 前端构建必须共享同一份 `web-dist`（每次 workflow 仅构建一次）。
- PR 场景保留当前 desktop 完整构建矩阵（`build` + `build-arm64`，若仓库为 public）。

### SHOULD

- 评估并落地 `tauri-cli` 与 Rust 依赖的缓存/预构建加速方案。
- 统一 web build 与 desktop build 之间的 artifact 复用策略。
- 同分支连续 push 时，旧运行可被取消以减少浪费。

### COULD

- 将非关键平台（如 arm64）限制为仅 main/发布分支运行。
- 允许通过标签/输入参数决定运行哪些 job。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub Actions workflow: desktop.yml | File format | internal | Modify | ./contracts/file-formats.md | CI | Maintainers, GitHub Actions | 触发条件/缓存/矩阵 |
| GitHub Actions workflow: ci.yml | File format | internal | Modify | ./contracts/file-formats.md | CI | Maintainers, GitHub Actions | 路径过滤（如需要） |
| GitHub Actions workflow: pages.yml | File format | internal | Modify | ./contracts/file-formats.md | CI | Maintainers, GitHub Actions | web build 触发策略 |

### 契约文档（按 Kind 拆分）

- [contracts/file-formats.md](./contracts/file-formats.md)

## 约束与风险

- 约束：保持现有必需检查与产物格式不变；不引入新 CI 平台或自建 runner。
- 风险：路径过滤可能漏掉关键变更；缓存失效或污染可能导致隐蔽失败。
- 成本（本项目）：仓库为 public，GitHub Actions 缓存不计费；但默认总缓存上限 10GB，超出会被 LRU 淘汰。

## 验收标准（Acceptance Criteria）

- Given PR 仅修改 `web/**` 或 `docs/**`
  When 推送提交
  Then desktop workflow 不触发（或仅运行 web/ci 必需的轻量 job）
- Given PR 修改 `desktop/**` 或 `desktop/src-tauri/**`
  When workflow 运行
  Then desktop workflow 触发且跨平台 build 保持当前覆盖范围
- Given 任一 desktop workflow 运行
  When 需要 web 前端产物
  Then 仅允许一次 `web-dist` 构建，其余 job 必须复用该产物
- Given 任一 desktop workflow 运行
  When 使用缓存/复用策略
  Then `Install tauri-cli` 与 `Desktop build` 的耗时相较基线降低（目标值见“开放问题/假设”确认）
- Given 同一分支连续 push
  When 新运行启动
  Then 旧运行被取消以减少排队与浪费
- Given PR 触发 desktop workflow
  When run 完成
  Then workflow 总时长 **≤ 10 分钟**（以 GitHub Actions run duration 为准）

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests: 不新增（保持现有 CI 口径）
- Integration tests: 不新增
- E2E tests: 不新增（保持 desktop smoke）

### UI / Storybook (if applicable)

- 不适用

### Quality checks

- 保持现有 `ci.yml`、`desktop.yml` 内的 lint/build/smoke 逻辑不降级

## 文档更新（Docs to Update）

- `docs/plan/README.md`: 索引新增 Plan 0014
- `docs/plan/0014:actions-speedup/PLAN.md`: 本计划内容
- `docs/plan/0014:actions-speedup/contracts/file-formats.md`: 工作流契约

## 里程碑（Milestones）

- [ ] M1: 复核近期 workflow 基线耗时并确认目标与触发规则
- [ ] M2: 设计 workflow 拆分/缓存/路径过滤方案与契约
- [ ] M3: 冻结验收标准与回退策略

## 方案概述（Approach, high-level）

- 先“减触发”、后“提速”：通过路径过滤或条件运行降低 desktop workflow 的触发频率，再优化构建步骤耗时。
- 统一 `web-dist` artifact 的复用策略，减少重复 web build。
- 评估 `tauri-cli` 与 Rust 依赖的缓存/预构建方案，优先降低跨平台重复编译成本。
- PR 与 main 采用不同策略：PR 侧强调反馈速度，main/发布侧保留完整矩阵。
- PR 侧不裁剪矩阵，通过缓存与产物复用达成 ≤ 10 分钟目标。
- `desktop/src-tauri/build.rs` 已支持在存在 `web/dist` 时同步到 `desktop/dist`，可作为复用 `web-dist` 的基础。

### 提速路线（候选，按优先级）

- P0: 单次 workflow 只产出一次 `web-dist`（`web-build`），其余 job 仅下载复用，禁止重复 web build。
- P0: 替换/缓存 `tauri-cli` 安装（优先预编译二进制；否则 cache `~/.cargo/bin` + `cargo install` 产物）。
- P1: 为 `cargo` registry/git/target 增加缓存（按 OS + 锁文件 hash 分桶）。
- P1: `pull_request` 增加路径过滤：仅 desktop/web/workflows 变更触发重型构建。
- P2: PR 侧精简矩阵（例如只保留 1–2 个平台），main/发布保持完整覆盖。

### 目标达成逻辑

- Desktop workflow 的总耗时取决于“最慢的 job”（并非 job 数量总和）。
- 若必须保留 Windows 构建，则需把 Windows job 压到 ≤10 分钟；否则 PR 侧需要降级矩阵或将 Windows 放到 main。

## 开放问题（Open Questions）

None.

## 假设（Assumptions）

- 不引入自建 runner 或付费 runner。
- 产物格式与 smoke 口径保持不变。
- 若 GitHub Actions 出现平台级故障，需要重新评估基线与结论。
- desktop 版本 web 前端构建需抽离为单独产物并复用（每次 workflow 仅构建一次）。

## 参考（References）

- Desktop workflow recent run: 21088739838 (2026-01-17)
- Desktop job bottleneck steps: `Install tauri-cli`, `Desktop build` (各平台耗时占比最高)
- CI / Pages workflows recent runs: 21088739860, 21088739881 (2026-01-17)
