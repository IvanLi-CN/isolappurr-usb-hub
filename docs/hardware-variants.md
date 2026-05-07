# 硬件方案（Hardware Variant）

本仓库的硬件方案为 `tps-sw`，核心电源/协议链路为 `SW2303 + TPS55288`。

## 方案

| 方案 | 关键芯片（核心差异） | 网表 |
| --- | --- | --- |
| `tps-sw` | `CH224Q + TPS55288 + SW2303` | `hardware/tps-sw/netlist.enet` |

> 说明：项目文档与固件假设均按 `tps-sw` 维护。

## 关键供电关系

- `TPS55288(U14)`：`VIN` 接 `VIN`，`VCC` 接 `+5V`，`SDA/SCL` 接 `SDA_TPS/SCL_TPS`。
- `SW2303(U16)`：`VIN` 接 `VOUT_TPS`，`VBUS` 接 `VBUS_TPS`，`SDA/SCL` 与 `TPS55288` 共用 `SDA_TPS/SCL_TPS`。
- `SDA_TPS/SCL_TPS` 由 `RN2` 上拉到 `3V3`，并同时连接 `TPS55288`、`SW2303`、调试排针 `U15` 与 ESP32-S3。

该连接要求 `SDA_TPS/SCL_TPS` 在 MCU 尝试配置 `TPS55288` 前保持可释放状态。若 `SW2303` 在 `VOUT_TPS` 低于其可工作电压时箝住 SDA，MCU 将无法先通过同一条 I2C 总线访问 `TPS55288`。

## 网表校验（可选）

如需确认仓库内网表是否与导出文件一致，可使用 sha256：

- `tps-sw`：`87b0c0b63cac06654158642e8a4ced09d797231791c45fa3d77e872e63cf3706`

## 文档适用范围

- 网表排查清单：`docs/netlist/tps-sw-checklist.md`
- 含 `SW2303` / `TPS55288` 的设计文档均按 `tps-sw` 方案维护。
