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

该连接要求 `SDA_TPS/SCL_TPS` 在 MCU 配置 `TPS55288` 前保持可释放状态。固件启动时先以 open-drain 释放 `SDA_TPS/SCL_TPS`，通过 `TPS55288` 的 `OE` 寄存器关闭输出并开启主动放电，延迟约 1 秒后检查总线电平；若总线被拉低，才允许短暂拉高 `CE_TPS` 做一次 hard-start。`TPS55288` 5V boot setpoint 写入成功后，固件继续释放总线并等待约 1.05 秒，再访问 `SW2303`。TPS 是否进入 5V 设定不得由 INA226 遥测判定。若 `SW2303` 上电后持续箝位 SDA，MCU 无法通过同一条 I2C 总线读取 PD 请求；固件保持 TPS boot 输出并等待总线释放，不反复掉电。

## 网表校验（可选）

如需确认仓库内网表是否与导出文件一致，可使用 sha256：

- `tps-sw`：`87b0c0b63cac06654158642e8a4ced09d797231791c45fa3d77e872e63cf3706`

## 文档适用范围

- 网表排查清单：`docs/netlist/tps-sw-checklist.md`
- 含 `SW2303` / `TPS55288` 的设计文档均按 `tps-sw` 方案维护。
