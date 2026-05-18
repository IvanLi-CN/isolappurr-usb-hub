# 硬件方案（Hardware Variant）

本仓库的硬件方案为 `tps-sw`，核心电源/协议链路为 `SW2303 + TPS55288`。

## 方案

| 方案 | 关键芯片（核心差异） | 网表 |
| --- | --- | --- |
| `tps-sw` | `CH224Q + TPS55288 + SW2303` | `hardware/tps-sw/netlist.enet` |

> 说明：项目文档与固件假设均按 `tps-sw` 维护。

## 关键供电关系

- `TPS55288(U14)`：`VIN` 接 `VIN`，`VCC` 接 `+5V`，`SDA/SCL` 接系统 I2C `SDA/SCL`。
- `SW2303(U16)`：`VIN` 接 `VOUT_TPS`，`VBUS` 接 `VBUS_TPS`，`SDA/SCL` 接独立 I2C `SDA_SW/SCL_SW`。
- `SDA/SCL/INT` 由 `RN1` 上拉到 `3V3`，并连接 `TPS55288`、`INA226`、`TMP112`、`EEPROM`、`CH224Q` 与 ESP32-S3 `GPIO8/GPIO9/GPIO7`。
- `SDA_SW/SCL_SW` 由 `R13/R3` 上拉到 `3V3`，并连接 `SW2303` 与 ESP32-S3 `GPIO39/GPIO40`。
- `CE_TPS` 仍由 ESP32-S3 `GPIO37` 通过 `Q5` 控制 `TPS55288 EN/UVLO`。
- `3V3_CH` 由 `U18(B0503S-1WR3)` 从 `UVBUS/UGND` 隔离生成，供 `U2(CH318T)` 与 `U7/U8(CH442E)`；`R40(DNP)` 保留 `3V3_CH` 与主 `3V3` 的可选连接位，默认不装。

当前硬件把 `TPS55288` 与 `SW2303` 分到两条 I2C 总线上，避免 `SW2303` 上电窗口拖住 `TPS55288` 配置路径。固件应通过 `SDA/SCL` 访问 `TPS55288(0x74)`，通过 `SDA_SW/SCL_SW` 访问 `SW2303(0x3C)`；`TPS55288 FB/INT` 进入共享 `INT` 线，后续固件需要在该线上处理多设备告警来源。

## 固件相关网表变化

- `TPS55288` 不再位于旧 `SDA_TPS/SCL_TPS` 网络；后续固件应使用 `GPIO8/GPIO9` 对应的 `SDA/SCL` 总线访问。
- `SW2303` 使用 `GPIO39/GPIO40` 对应的 `SDA_SW/SCL_SW` 独立总线访问。
- `GPIO38/INT_TPS` 不再连接；`TPS55288` 的 `FB/INT` 改接共享 `INT(GPIO7)`。
- `U15` 改为 3Pin 串口调试口：`GND/U0TX/U0RX`，不再引出 `CE_TPS/INT_TPS/SDA_TPS/SCL_TPS`。
- `LEDD` 与 `UP0_PG` 到 MCU 之间增加 `R39/R33=10kΩ` 串联电阻，固件语义保持高阻采样。
- 上游侧 `U18(CH442E)` 已由 `B0503S-1WR3` 替代；旧 `PU_CE/PU_CED` 侧带控制路径不再存在。

## 网表校验（可选）

如需确认仓库内网表是否与导出文件一致，可使用 sha256：

- `tps-sw`：`bb281174e58a39d6e06f5ea9a9d986ab450386dccb49be98d4a517c8c84e8a5a`

## 文档适用范围

- 网表排查清单：`docs/netlist/tps-sw-checklist.md`
- 含 `SW2303` / `TPS55288` 的设计文档均按 `tps-sw` 方案维护。
