# `tps-sw` MCU 资源分配

本文是当前正式 `tps-sw` 硬件的 MCU 资源合同，覆盖 GPIO、外设控制器、
总线、中断、DMA、定时器、通信接口和启动安全态。硬件连接以
[`hardware/tps-sw/netlist.enet`](../hardware/tps-sw/netlist.enet) 为准，
运行配置以当前固件为准。不得把本文的空闲资源直接套用到 `tps-fusb`。

## 状态与事实源

| 标记 | 含义 |
| --- | --- |
| 已连接 | 正式 `tps-sw` 网表已有连接 |
| 已实现 | 当前固件已经初始化或使用 |
| 预留 | 受启动、调试或兼容约束，不等同于可自由分配 |

- MCU：ESP32-S3；正式网表器件名为 `ESP32-S3R2(U19)`。
- PD 输入：CH224Q 硬件协商；PD 输出：SW2303 + TPS55288。
- Firmware profile：当前固件实现；未来与 `tps-fusb` 独立构建。

## 控制器资源总览

| MCU 资源 | 配置 | 所有者 | 状态 |
| --- | --- | --- | --- |
| `I2C1` | 400 kHz async；GPIO8/9 | TPS、遥测、EEPROM | 已连接、已实现 |
| `I2C0` | 400 kHz async；GPIO39/40 | SW2303 | 已连接、已实现 |
| `SPI2` | Mode 0，40 MHz；GPIO10-14 | GC9307 | 已连接、已实现 |
| `DMA_CH0` | SPI RX/TX 各 4096 bytes | GC9307 | 已实现、独占 |
| `LEDC` | low-speed timer 0/channel 0；GPIO21 | 蜂鸣器 | 已实现、独占 |
| `USB_DEVICE` | USB Serial/JTAG；GPIO19/20 | JSONL、provisioning、维护 | 已连接、已实现 |
| `UART0` | GPIO43/44 | 3-pin 调试串口 | 已连接 |
| GPIO interrupt | GPIO7，AnyEdge | 系统告警协调器 | 已连接、已实现 |
| ADC | 无 | - | 未占用 |
| PSRAM | 启动初始化；显示缓冲和外部分配 | 显示/分配器 | 已实现；容量须实机确认 |

新增功能不能只检查 GPIO；还必须检查控制器实例、DMA、LEDC timer/channel
和中断资源是否已被独占。

## I2C 资源

### `I2C1` 系统总线

| 网络 | GPIO | 速率 | 物理成员 | 固件合同 |
| --- | --- | --- | --- | --- |
| `SDA` | 8 | 400 kHz | TPS55288、INA226 x2、TMP112、EEPROM、CH224Q | 3.3 V 上拉，禁止扫描 |
| `SCL` | 9 | 400 kHz | 同上 | 3.3 V 上拉，禁止扫描 |

当前固件 allowlist 只允许 INA226 fallback 地址 `0x40/0x44`、`0x41/0x45`、
EEPROM `0x50` 和 TPS55288 `0x74`。“物理连接”不表示固件会访问 TMP112 或
CH224Q。共享 `INT(GPIO7)` 为低有效开漏线；中断后必须查询候选器件消歧。

### `I2C0` PD 输出总线

| 网络 | GPIO | 速率 | 地址 | 约束 |
| --- | --- | --- | --- | --- |
| `SDA_SW` | 39 | 400 kHz | SW2303 `0x3C` | 独立 allowlist |
| `SCL_SW` | 40 | 400 kHz | SW2303 `0x3C` | 可用性由 PD 协调器管理 |

GPIO39/40 同时占用 ESP32-S3 外部 JTAG 信号资源。当前版应使用 USB
Serial/JTAG 或 UART0 调试，不能同时把 GPIO39/40 作为外部 JTAG。

## 显示、通信与定时资源

| 功能 | GPIO / 资源 | 约束 |
| --- | --- | --- |
| GC9307 DC/MOSI/SCLK/CS/RES | GPIO10/11/12/13/14；`SPI2` | Mode 0，40 MHz，DMA_CH0 |
| GC9307 BLK | GPIO15 | 低有效；初始化前保持关闭 |
| 原生 USB D-/D+ | GPIO19/20；`USB_DEVICE` | 禁止复用为普通 GPIO |
| 蜂鸣器 | GPIO21；`LEDC LS timer0/channel0` | 先输出静音电平，再交给 LEDC |
| UART0 TX/RX | GPIO43/44 | 调试用途，不参与控制闭环 |

## GPIO 控制与采样

| GPIO | 网络 | 方向 / 有效电平 | 安全要求 | 状态 |
| --- | --- | --- | --- | --- |
| 0 | `BTNR` | 输入，低有效 | 内部上拉；同时受启动约束 | 已连接、已实现 |
| 1 | `BTNL` | 输入，低有效 | 内部上拉 | 已连接、已实现 |
| 2 | `P2_CED` | 输出，低有效 | 默认不接通数据路径 | 已连接、已实现 |
| 4 | `P1_CED` | 输出，低有效 | 默认不接通数据路径 | 已连接、已实现 |
| 5 | `P1_ESP` | 输出 | USB-A 数据路由 | 已连接、已实现 |
| 6 | `LEDD` | 输入，低有效 | 高阻采样隔离侧 ready | 已连接、已实现 |
| 7 | `INT` | 输入，低有效 | AnyEdge，共享开漏告警 | 已连接、已实现 |
| 16 | `P1_EN#` | 输出，低有效 | 初始化前保持端口关闭 | 已连接、已实现 |
| 17 | `P1_FAULT` | 输入，低有效 | 故障采样 | 已连接、已实现 |
| 18 | `UP0_PG` | 输入，高有效 | 高阻采样隔离侧状态 | 已连接、已实现 |
| 37 | `CE_TPS` | 输出，经 NMOS | 初始化先保持 TPS 关闭 | 已连接、已实现 |

## 启动、保留与余量

- GPIO0 是启动相关引脚；上电或复位期间不得持续按低 `BTNR`。
- GPIO15/16 已用于背光和 USB-A 电源控制，不能再提供 32.768 kHz 晶振。
- GPIO19/20 固定为原生 USB；GPIO39/40 固定为本版 `I2C0`。
- GPIO3、GPIO33-36、GPIO38、GPIO41-42、GPIO45-46 在网表未连接；其中
  strap/启动相关引脚仍是预留资源，不是无条件可用 GPIO。
- GPIO38 不再作为 `INT_TPS`；TPS55288 `FB/INT` 已并入 GPIO7 `INT`。

## 安全启动顺序

1. 先把 `P1_EN#`、`P1_CED`、`P2_CED`、`CE_TPS` 初始化到关闭状态。
2. 保持背光关闭，初始化 SPI/DMA 后再释放显示复位。
3. 初始化 `I2C1`、共享中断和 allowlist，不执行总线扫描。
4. 初始化 `I2C0`，确认 SW2303 总线可用后再启动 PD 输出协调器。
5. 完成状态核验后，才允许打开下游端口或 TPS 输出。

## 变更与验证门禁

- 原理图修改必须同步正式网表、本文和 firmware profile 常量。
- bring-up 必须验证两条 I2C、共享中断消歧、显示 DMA、USB console、蜂鸣器
  静音启动，以及全部电源/数据控制信号的复位默认态。
