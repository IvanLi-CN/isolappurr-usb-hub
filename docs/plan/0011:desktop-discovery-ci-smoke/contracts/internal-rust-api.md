# Internal Rust API（discovery injection）

本文件描述用于**确定性测试**的 discovery 注入接口形状；目标是让 CI 可以模拟 “mDNS/DNS‑SD resolved” 输入，而不依赖 multicast 环境。

## discovery resolved 注入

- 范围（Scope）: internal
- 变更（Change）: Modify

### 目标

- 测试进程可注入 resolved 事件，触发与真实 resolved 相同的处理路径（候选 URL 生成 → `GET /api/v1/info` 校验 → 去重合并）。
- 注入接口不对最终产品用户暴露（仅在模块边界/测试边界可用）。

### 建议形状（建议主人确认；最终以实现为准）

```rust
/// A normalized “resolved” input (from mDNS/DNS-SD or tests).
pub struct ResolvedService {
  pub hostname: String,
  pub port: u16,
  pub ipv4: Option<std::net::Ipv4Addr>,
}

impl DiscoveryController {
  /// Process a resolved service candidate (shared path for real mDNS and injected tests).
  pub async fn handle_resolved(&self, input: ResolvedService) -> anyhow::Result<()>;
}
```

### 错误（Errors）

- 该接口不应因为候选无效/HTTP 不可达而返回错误（应视为“被过滤”，并可通过日志/诊断摘要体现）。
- 仅“内部不可恢复错误”（例如解析/状态锁严重错误）才应返回 `Err`。

### 兼容性与迁移（Compatibility / migration）

- `handle_mdns_event(ServiceEvent)` 应改为“只做 mDNS 事件解析/过滤”，并将解析结果转交给 `handle_resolved(...)`，以保证路径复用。

## discovery 后端不可用（降级语义）

- 范围（Scope）: internal
- 变更（Change）: Modify

### 目标

- 当 mDNS 后端初始化失败或 browse 失败时：
  - agent server 仍可启动（HTTP API 可用；IP scan/manual add 能继续）
  - discovery snapshot 中应体现 `status=unavailable` 与可读的 `error` 文案

### 建议形状（建议主人确认）

- `start_agent_server(...)` 不再把 mDNS 初始化失败作为“启动失败”直接返回；而是将错误记录到 snapshot 中并继续启动。

