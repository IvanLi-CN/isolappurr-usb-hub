# Config（CI workflow）

本文件描述 Plan #0011 对 CI 的配置约定（GitHub Actions）；用于确保“跨平台 discovery smoke tests”成为可重复、可诊断的质量门槛。

## GitHub Actions：`.github/workflows/desktop.yml`

- 范围（Scope）: internal
- 变更（Change）: Modify

### 目标

- 在 Desktop build 之后增加 discovery smoke tests 步骤。
- 覆盖平台：`windows-latest`、`ubuntu-24.04`、`macos-14`。
- 默认不上传 artifacts；诊断只允许 stdout/stderr 或 step summary（纯文本）。

### 建议形状（建议主人确认；最终以实现为准）

- jobs：使用 matrix（os）或拆分 job，但必须保证三平台都执行 smoke tests。
- steps（示意）：
  1. checkout
  2. setup bun + web check/build（沿用既有）
  3. setup rust
  4. desktop build（沿用既有；macOS 继续保持 ad-hoc signing 口径）
  5. `cd desktop && cargo test`（仅跑 smoke tests；总耗时 ≤ 60s/平台）

### 失败诊断（必须）

- smoke tests 失败时输出：
  - 候选摘要（hostname/port/ip/baseUrl）
  - HTTP 校验结果（status 或错误摘要）
  - 过滤原因与超时原因（若适用）
  - 是否进入降级（mDNS unavailable）与提示文案

### 成本约束（引用）

- 默认不上传大体积 artifacts；若未来需要上传调试材料，必须遵守 Plan #0009 的“仅文本 + ≤ 1 小时保留”约束。

