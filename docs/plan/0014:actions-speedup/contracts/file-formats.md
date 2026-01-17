# File formats / Config contracts

本计划涉及 GitHub Actions workflow 配置文件的修改（内部接口）。以下契约用于约束触发规则、矩阵与产物复用策略，保证可实现与可测试。

## .github/workflows/desktop.yml

- Change: Modify
- Scope: internal
- Owner: CI

### Current (baseline)

- 触发：`pull_request`、`push`、`workflow_dispatch`（无路径过滤）
- Jobs：`web-build`（产物 `web-dist`）、`build`（macos/windows/linux）、`build-arm64`（windows-arm64/linux-arm64）
- 主要耗时：`Install tauri-cli` 与 `Desktop build`

### Proposed (default; pending confirmation)

- 在 `pull_request` 上增加 `paths` 或 `paths-ignore`，仅当变更影响 desktop/web/自身 workflow 时触发。
- PR 场景保留完整矩阵：`build` + `build-arm64`（仓库为 public 时）。
- `web-build` 继续生成 `web-dist`，其余 build job 复用该 artifact 并跳过重复 web build。
- 引入缓存策略以降低 `tauri-cli` 安装与 Rust 依赖构建耗时（具体缓存 key/路径在实施阶段确定）。

### Artifact contract

- Artifact name: `web-dist`
- Path: `web/dist`
- Retention: 7 days
- Producers: `web-build` job（唯一）
- Consumers: `build` / `build-arm64` jobs（所有平台）
- Failure mode: 若 `web-dist` 缺失，build job 需明确失败（不允许静默回退）。
  - Build jobs 不得重复执行 web build；需基于 `web-dist` 产物进行桌面构建。

### Compatibility / rollback

- 若缓存导致不稳定，允许通过单次提交关闭缓存步骤。
- 若路径过滤遗漏关键变更，需补充匹配规则并回填测试用例（见验收标准）。

## .github/workflows/ci.yml

- Change: Modify
- Scope: internal
- Owner: CI

### Proposed (default; pending confirmation)

- 为 `pull_request` 添加 `paths` 或 `paths-ignore`，避免 docs-only 变更触发重型检查。
- 不改变现有检查内容与输出。

## .github/workflows/pages.yml

- Change: Modify
- Scope: internal
- Owner: CI

### Proposed (default; pending confirmation)

- 为 `pull_request` / `push` 添加 `paths` 过滤，仅在 web 相关变更时运行。
- 若拆分 web build workflow，则 `pages.yml` 仅负责部署，build 产物通过 artifact 或 `needs` 获取。
