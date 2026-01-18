# 文件格式（File formats）

本计划将 GitHub Actions workflow 配置文件视为内部接口契约，约束触发条件与执行条件，确保可实现与可验证。

## GitHub Actions workflow（.github/workflows/desktop.yml）

- 范围（Scope）: internal
- 变更（Change）: Modify
- 编码（Encoding）: utf-8

### Schema（结构）

目标行为用事件与条件表达如下：

- `pull_request`：
  - 仅当 PR 来自**同仓库分支**时运行 desktop（fork PR 跳过）
  - 触发后按既有矩阵与检查执行（lint/build/smoke 不变）
- `push`：
  - branches: `main`, `release/*`
  - tags: `*`
  - 其他分支 `push` 不触发 desktop
- `workflow_dispatch`：保留

### Examples（示例）

示例仅用于表达契约形状（实施阶段以仓库现状为准）：

```yaml
on:
  pull_request:
  push:
    branches: [main, "release/*"]
    tags: ["*"]
  workflow_dispatch:
```

fork PR 跳过建议通过 job-level 条件实现（确保不会运行 build job）：

```yaml
if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == false
```

### 兼容性与迁移（Compatibility / migration）

- 若 desktop workflow 的检查项被设置为 required checks，fork PR 跳过可能导致无法合并；需由维护者在 GitHub 设置侧调整 required checks 策略或关闭 fork PR 合并路径。

