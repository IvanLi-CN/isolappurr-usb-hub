# 硬件方案（Hardware Variant）

本仓库的硬件方案为 `tps-sw`，核心电源/协议链路为 `SW2303 + TPS55288`。

## 当前方案

| 方案 | 关键芯片（核心差异） | 网表 |
| --- | --- | --- |
| `tps-sw` | `CH224Q + TPS55288 + SW2303` | `hardware/tps-sw/netlist.enet` |

> 说明：项目文档与固件假设均按 `tps-sw` 维护。

## 网表校验（可选）

如需确认仓库内网表是否与导出文件一致，可使用 sha256：

- `tps-sw`：`7c447317f5a003d1fd8e83c308c922065ff089650f8dea0a8a51e185fc7f6321`

## 文档适用范围

- 网表排查清单：`docs/netlist/tps-sw-checklist.md`
- 含 `SW2303` / `TPS55288` 的设计文档均按当前 `tps-sw` 方案维护。
