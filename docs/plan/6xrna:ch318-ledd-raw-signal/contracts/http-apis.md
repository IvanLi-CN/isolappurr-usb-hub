# HTTP APIs（Plan 6xrna：`/api/v1/ports` hub 上游状态）

本文件定义本计划对既有 HTTP API 的**增量变更**，用于把“隔离型 USB Hub 与上游主机的连接指示”以 Hub 级字段对外暴露。

## `GET /api/v1/ports`

- Kind: HTTP API
- Scope: external
- Change: Modify

### Response（200）

在既有返回中新增 `hub` 对象：

```json
{
  "hub": { "upstream_connected": true },
  "ports": [
    {
      "portId": "port_a",
      "label": "USB-A",
      "telemetry": {
        "status": "ok",
        "voltage_mv": 5000,
        "current_ma": 120,
        "power_mw": 600,
        "sample_uptime_ms": 123450
      },
      "state": {
        "power_enabled": true,
        "data_connected": true,
        "replugging": false,
        "busy": false
      },
      "capabilities": { "data_replug": true, "power_set": true }
    }
  ]
}
```

### Semantics

- `hub.upstream_connected`：Hub 级“上游连接指示”状态位（1-bit）。
  - tps-sw：该字段由 `CH318T U2 LED/MODE(LEDD)` 节点提供（MCU `GPIO6` 高阻采样，active-low），固件对输入做稳定化（去抖）后输出。
  - 固件保证该字段为稳定化后的输入，不承诺更强语义（例如“枚举完成/协议细节”）。
