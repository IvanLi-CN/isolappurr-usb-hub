# CLI（Plan #0011 口径）

本计划以现有 `isolapurr-desktop` CLI 为基础，定义 discovery smoke tests 可依赖的稳定口径。

## `isolapurr-desktop discover`

- 范围（Scope）: external
- 变更（Change）: Modify

### 用法（Usage）

```text
isolapurr-desktop discover [--json]
```

### 参数（Args / options）

- `--json`: 以 JSON 输出 discovery 结果（default: false）

### 输出（Output）

- `--json`:
  - Format: json
  - Schema:
    - `{ "devices": DiscoveredDevice[] }`
    - `DiscoveredDevice.baseUrl` 为必填；其余字段为可选（与 HTTP snapshot 的 device 形状对齐）
- 不带 `--json`:
  - Format: human
  - 每行输出一个 `baseUrl`

### 退出码（Exit codes）

- `0`: 命令执行完成（即使 discovery 结果为空）
- `20`: discovery 不可用（例如 mDNS 后端初始化/browse 失败）

### 兼容性与迁移（Compatibility / migration）

- 本计划允许在 stderr 增加更可读的诊断信息（不改变 stdout 的 parseable 形状）。

