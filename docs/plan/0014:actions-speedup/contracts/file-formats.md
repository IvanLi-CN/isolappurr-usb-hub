# File formats / Config contracts

本计划涉及 GitHub Actions workflow 配置文件的修改（内部接口）。以下契约用于约束触发规则、矩阵与产物复用策略，保证可实现与可测试。

## .github/workflows/desktop.yml

- Change: Modify
- Scope: internal
- Owner: CI

### Current (baseline)

- 触发：`pull_request`、`push`、`workflow_dispatch`（PR 对 `docs/**`、`README.md` 做了忽略；web-only PR 仍会触发 desktop workflow）
- Jobs：`web-build`（产物 `web-dist`）、`build`（macos/windows/linux）、`build-arm64`（windows-arm64/linux-arm64）
- 主要耗时：`Install tauri-cli` 与 `Desktop build`

### Implemented (this plan)

- PR：仅当变更影响 `desktop/**` 或 `.github/workflows/desktop.yml` 时触发（web-only / docs-only PR 跳过）。
- Push：仅 `main` 分支触发（且仅当变更影响 `desktop/**` / `web/**` / `.github/workflows/desktop.yml`）。
- PR 场景保留完整矩阵：`build` + `build-arm64`（仓库为 public 时）。
- `web-build` 继续生成 `web-dist`，其余 build job 复用该 artifact 并跳过重复 web build。
- 引入缓存策略以降低 `tauri-cli` 安装与 Rust 依赖构建耗时：
  - `~/.cargo/registry` / `~/.cargo/git` / `desktop/src-tauri/target`（按 OS+arch + `desktop/src-tauri/Cargo.lock` hash 分桶）
  - `~/.cargo/bin`（按 OS+arch + `tauri-cli` version 分桶）

### Artifact contract

- Artifact name: `web-dist`
- Path: `web/dist`
- Retention: 1 day（并在 workflow 结束时由 `cleanup-artifacts` 主动删除）
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

### Implemented (this plan)

- 为 `pull_request` 添加 `paths-ignore`（`docs/**`、`README.md`），避免 docs-only PR 触发重型检查。
- 不改变现有检查内容与输出（仅调整触发条件）。

## .github/workflows/pages.yml

- Change: Modify
- Scope: internal
- Owner: CI

### Implemented (this plan)

- 为 `pull_request` 添加 `paths` 过滤，仅在 web 相关变更时运行。
- `push` 维持既有 `paths` 过滤（仅在 web 相关变更时运行）。
