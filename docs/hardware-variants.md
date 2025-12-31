# 硬件方案（Hardware Variants）

本仓库已进入**多硬件方案**阶段：硬件相关产物（网表、后续的原理图/PCB 等）统一放在 `hardware/<variant>/`，并且**只用方案名命名**（不使用 PCB 版本号、工程版本号等）。

## 方案列表

| 方案 | 关键芯片（核心差异） | 网表 |
| --- | --- | --- |
| `tps-sw` | `CH224Q + TPS55288 + SW2303` | `hardware/tps-sw/netlist.enet` |
| `ip6557` | `CH224Q + IP6557` | `hardware/ip6557/netlist.enet` |

> 说明：两种方案都包含大量共享器件（如 `CH318T`、`INA226` 等），但 USB‑C 下行口的电源/协议实现不同。

## 网表校验（可选）

如需确认仓库内网表是否与导出文件一致，可使用 sha256：

- `tps-sw`：`1e602e4fc3a6477e24eb5f4ba9913aff53b7b42b0a81db77c6d695fff8f364d3`
- `ip6557`：`c9840e26e768942737f541bae473efa565f8ae8a290fad8c7da4a9f57c6a03bf`

## 文档适用范围（重要）

- 网表排查清单：
  - `docs/netlist/tps-sw-checklist.md`：仅适用于 `tps-sw`
- 含 `SW2303` / `TPS55288` 的设计文档默认仅适用于 `tps-sw`；`ip6557` 的固件与设计细节后续补齐（本次不改固件）。
