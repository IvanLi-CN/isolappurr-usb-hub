# `tps-sw` MCU 使用规范

本文是当前正式 `tps-sw` 硬件使用 ESP32-S3 的说明、指导和约束。原理图、
PCB、firmware profile、驱动和 bring-up 必须同时遵守本文。本文包含 MCU
资源分配、封装引脚分配、外设初始配置、用途、安全默认态和注意事项。

## 1. 适用范围与事实源

| 项目 | 本版合同 |
| --- | --- |
| Hardware variant | `tps-sw`（当前正式版本） |
| MCU | `ESP32-S3R2(U19)` |
| 封装 | QFN-56-EP，7 mm x 7 mm，0.4 mm pitch |
| 料号证据 | `hardware/tps-sw/netlist.enet` 中 U19 |
| 固件证据 | `src/bin/firmware_main/` 与 `src/buzzer/ledc.rs` |
| PD 输入/输出 | CH224Q / SW2303 + TPS55288 |

网表与固件不一致时不得任选其一继续设计：必须先确认实板，修正事实源后再
更新本文。`tps-fusb` 使用独立规范，不得复制本表中的“空闲”结论。

## 2. MCU 器件与固定资源

- U19 为裸片 `ESP32-S3R2`，不是 ESP32-S3 模组。天线匹配、40 MHz 晶体、
  `CHIP_PU`、供电去耦和 exposed pad 均属于板级设计责任。
- R2 型号包含 2 MB Quad-SPI PSRAM；程序 Flash 及其实际容量必须由硬件/BOM
  与构建配置共同确认，不能仅由 `R2` 后缀推断。
- 封装 Pin 28、30-37 属于 SPI Flash/PSRAM 固定总线，不分配为普通 GPIO。
- GPIO0、GPIO3、GPIO45、GPIO46 是 strapping 相关资源。
- GPIO19/20 固定用于原生 USB；GPIO39/40 已占用外部 PAD-JTAG 信号位置。

## 3. MCU 资源分配

| 资源 | 分配与初始配置 | 用途 | 注意事项 |
| --- | --- | --- | --- |
| CPU/async runtime | ESP32-S3；Embassy async | 主控制与任务调度 | PD/I2C 不得在 ISR 内阻塞 |
| `I2C1` | 400 kHz async，transaction timeout 20 ms | TPS、遥测、EEPROM | GPIO8/9；静态 allowlist |
| `I2C0` | 400 kHz async，transaction timeout 20 ms | SW2303 | GPIO39/40；静态 allowlist |
| `SPI2` | Mode 0，40 MHz async | GC9307 | MOSI/SCLK，无 MISO |
| `DMA_CH0` | RX/TX buffer 各 4096 bytes | 显示 SPI | 被显示独占 |
| `LEDC` | LS timer0/channel0，APB clock，10-bit | 蜂鸣器 | 初始 1 kHz、0% duty |
| GPIO interrupt | GPIO7，AnyEdge | 共享 `INT` | 外部 4.7 kOhm 上拉，低有效 |
| `USB_DEVICE` | USB Serial/JTAG | JSONL、配置与维护 | GPIO19/20 不可复用 |
| `UART0` | U0TX/U0RX | 3-pin 调试口 | GPIO43/44 |
| ADC | 未分配 | - | 当前版无 MCU VIN ADC |
| PSRAM | 启动初始化 | display framebuffer | 固件依赖；当前识别记录存在 `psramSize=null` 不一致 |

## 4. GPIO 引脚分配总表

“初始配置”指 firmware 接管 GPIO 时必须先建立的状态；它不能替代外部上拉、
下拉或 gate 偏置。`NC` 表示当前正式网表未连接，不代表跨版本可随意使用。

| Package Pin | MCU pin | 网络/功能 | 方向与初始配置 | 用途与注意事项 |
| ---: | --- | --- | --- | --- |
| 5 | GPIO0 | `BTNR` | 输入，内部上拉，低有效 | 右键；[STRAP] 复位时持续拉低会改变启动模式 |
| 6 | GPIO1 | `BTNL` | 输入，内部上拉，低有效 | 左键；软件去抖 30 ms |
| 7 | GPIO2 | `P2_CED` | 推挽输出，初始 Low | CH442E EN#；Low=USB-C 数据接通 |
| 8 | GPIO3 | NC | 不初始化 | [STRAP] 保留 |
| 9 | GPIO4 | `P1_CED` | 推挽输出，初始 Low | CH442E EN#；Low=USB-A 数据接通 |
| 10 | GPIO5 | `P1_ESP` | 推挽输出，初始 High | USB-A 数据路由；High=USB-C/TPS 路径 |
| 11 | GPIO6 | `LEDD` | 高阻输入，无内部上下拉 | 隔离侧 ready，低有效 |
| 12 | GPIO7 | `INT` | 高阻输入，无内部上下拉，AnyEdge | 共享开漏告警，外部 4.7 kOhm 上拉 |
| 13 | GPIO8 | `SDA` / I2C1 | 双向开漏，由 I2C 接管 | 系统 I2C 数据，外部上拉 |
| 14 | GPIO9 | `SCL` / I2C1 | 双向开漏，由 I2C 接管 | 系统 I2C 时钟，外部上拉 |
| 15 | GPIO10 | `DC` | 推挽输出，初始 Low | GC9307 data/command |
| 16 | GPIO11 | `MOSI` / SPI2 | 推挽外设输出 | GC9307 数据 |
| 17 | GPIO12 | `SCLK` / SPI2 | 推挽外设输出 | GC9307 40 MHz 时钟 |
| 18 | GPIO13 | `CS` | 推挽输出，初始 High | GC9307 片选，低有效 |
| 19 | GPIO14 | `RES` | 推挽输出，初始 High | GC9307 复位，低有效 |
| 21 | GPIO15/XTAL_32K_P | `BLK` | 推挽输出，当前固件初始 Low | 背光低有效；占用后不能接 32 kHz 晶体 |
| 22 | GPIO16/XTAL_32K_N | `P1_EN#` | 推挽输出，当前固件初始 Low | USB-A 电源 Low=开；占用 32 kHz 晶体脚 |
| 23 | GPIO17 | `P1_FAULT` | 输入 | 网表已连接；当前固件未初始化，接入前确认极性/上下拉 |
| 24 | GPIO18 | `UP0_PG` | 高阻输入，无内部上下拉 | 隔离侧 fault，高有效，外部 100 kOhm 上拉 |
| 25 | GPIO19 | `USB_D-` | USB peripheral | 原生 USB D-；保持 90 Ohm differential |
| 26 | GPIO20 | `USB_D+` | USB peripheral | 原生 USB D+；不得作为普通 GPIO |
| 27 | GPIO21 | `BUZZER` | 先推挽 Low，再交给 LEDC | 5 mA drive，默认静音 |
| 38 | GPIO33 | NC | 不初始化 | 当前版余量，不得自动用于下一版 |
| 39 | GPIO34 | NC | 不初始化 | 当前版余量 |
| 40 | GPIO35 | NC | 不初始化 | 当前版余量 |
| 41 | GPIO36 | NC | 不初始化 | 当前版余量 |
| 42 | GPIO37 | `CE_TPS` | 推挽输出，初始 High | High 经 NMOS 拉低 EN/UVLO，TPS 硬关闭 |
| 43 | GPIO38 | NC | 高阻/不初始化 | 旧 `INT_TPS` 已废弃，不得按旧文档接线 |
| 44 | GPIO39/MTCK | `SDA_SW` / I2C0 | 双向开漏，由 I2C 接管 | SW2303 数据；占用 PAD-JTAG MTCK |
| 45 | GPIO40/MTDO | `SCL_SW` / I2C0 | 双向开漏，由 I2C 接管 | SW2303 时钟；占用 PAD-JTAG MTDO |
| 47 | GPIO41/MTDI | NC | 不初始化 | PAD-JTAG 相关，预留 |
| 48 | GPIO42/MTMS | NC | 不初始化 | PAD-JTAG 相关，预留 |
| 49 | GPIO43/U0TXD | `U0TX` | UART0 TX | 网表已连接；当前主固件未显式初始化 UART0 |
| 50 | GPIO44/U0RXD | `U0RX` | UART0 RX | 网表已连接；当前主固件未显式初始化 UART0 |
| 51 | GPIO45 | NC | 不初始化 | [STRAP] 保留 |
| 52 | GPIO46 | NC | 仅输入/不初始化 | [STRAP] 保留，不得设计为输出 |

## 5. 固定封装引脚

| Package Pin | 引脚 | 连接/要求 |
| ---: | --- | --- |
| 1 | `LNA_IN` | RF matching network/antenna；禁止数字走线靠近 |
| 2, 3, 20, 46, 55, 56 | 3.3 V supply pins | 按 Espressif reference design 独立就近去耦 |
| 4 | `CHIP_PU` | `CHIP_EN`；必须有确定上电复位网络，不可浮空 |
| 28, 30-37 | SPI Flash/PSRAM bus | 固定资源，不得引出或复用 |
| 29 | `VDD_SPI` | 3.3 V；供内部/外部 SPI memory domain |
| 53, 54 | `XTAL_N/P` | 40 MHz crystal network；对称、短、远离高速线 |
| 57/EP | GND/exposed pad | 完整接地与散热过孔阵列 |

## 6. 外设初始配置规范

### 6.1 GPIO 与电源路径

- 按键：GPIO0/1，input + internal pull-up，低有效，30 ms debounce。
- `LEDD`、`UP0_PG`、`INT`：input + `Pull::None`，不得用 MCU 内部上拉改变
  外围电路工作点。
- 当前 firmware 的产品启动态为 USB-A 电源开启、两路数据接通、USB-A 数据
  路由到 USB-C、TPS 硬关闭：`P1_EN#=0`、`P1_CED=0`、`P2_CED=0`、
  `P1_ESP=1`、`CE_TPS=1`。
- `CE_TPS` 是硬复位/恢复手段；日常关断优先使用 TPS55288 `OE`，避免无故
  让 SW2303 掉电并重新经历 POR。

### 6.2 I2C1 系统总线

- 初始化：`I2C1`、GPIO8 SDA、GPIO9 SCL、400 kHz async、20 ms transaction
  timeout；SDA/SCL 使用板上 3.3 V 外部上拉。
- 物理成员：TPS55288、INA226 x2、TMP112、M24C64 EEPROM、CH224Q。
- 固件 allowlist：`0x40/0x44`、`0x41/0x45`、`0x50`、`0x74`。
- 禁止地址扫描。TMP112/CH224Q 虽物理连接，但当前固件无访问合同。

### 6.3 I2C0 SW2303 总线

- 初始化：`I2C0`、GPIO39 SDA、GPIO40 SCL、400 kHz async、20 ms transaction
  timeout，allowlist 仅 `0x3C`。
- SW2303 由 `VOUT_TPS` 供电。TPS 未建立输出或 SW2303 未完成 POR 时不得访问。
- 总线恢复可暂时把引脚作为带上拉的开漏 GPIO，但恢复后必须归还 I2C0。

### 6.4 SPI2 显示与 DMA

- `SPI2` Mode 0、40 MHz、MOSI GPIO11、SCLK GPIO12；无 MISO。
- CS/DC/RES 分别为 GPIO13/10/14；`DMA_CH0` RX/TX buffer 各 4096 bytes。
- `BLK` 为低有效。当前固件启动即拉低开启；若修改启动策略，必须保证显示
  初始化失败时仍能明确控制背光，不能留下浮空状态。

### 6.5 LEDC 蜂鸣器

- GPIO21 push-pull、5 mA、无上下拉；接管 LEDC 前先输出 Low。
- LEDC global slow clock=`APBClk`，low-speed timer0，channel0，10-bit duty；
  初始 1 kHz、0% duty。任何初始化失败都必须保持静音。

### 6.6 USB、UART 与调试

- 原生 USB 固定使用 GPIO19/20；用于 USB Serial/JTAG 与维护通信。
- UART0 使用 GPIO43/44，仅作为调试接口，不参与安全控制。
- GPIO39/40 已给 I2C0，传统 PAD-JTAG 不可用；不得烧录会破坏 USB
  Serial/JTAG 维护路径的 eFuse 配置。

### 6.7 PSRAM 与内部存储

- 固件使用 `esp-hal` PSRAM feature，并在启动时初始化 PSRAM；显示 front、
  back、dashboard-base framebuffer 必须分配在 external memory，失败即 fail-fast。
- 固件信息合同固定 Flash 为 4 MB，并运行时报告 PSRAM bytes。最近维护记录中
  `espflash` 板卡识别曾返回 `psramSize=null`；该字段不等同于固件运行时探测，
  但构成硬件/BOM/工具识别不一致，下一次实机验收必须读取 firmware `info`
  的 `hardware.psram_bytes` 并核对分配成功，未验证前不得宣称 PSRAM 已闭环。

## 7. 上电初始化顺序

1. 建立所有电源/数据控制 GPIO 的确定电平，尤其先保持 `CE_TPS=High`。
2. 初始化按键和状态输入；读取低有效中断的初始电平。
3. 初始化 I2C1 和 I2C0；I2C0 此时只完成控制器/引脚配置，禁止发起 SW2303 事务。
4. 释放 `CE_TPS`，配置 TPS55288 为输出关闭/放电及 boot setpoint；等待 TPS
   输出与 SW2303 POR 后，才解除 SW2303 事务门控并访问 `0x3C`。
5. 初始化 SPI2/DMA/显示和 LEDC；最后启动应用任务与端口状态机。

## 8. 设计与维护注意事项

- GPIO0 的按键电路必须保证复位时默认高；GPIO3/45/46 不接功率使能。
- GPIO15/16 已占用 32 kHz 晶体功能，本版不能再宣称支持外部 RTC crystal。
- I2C 上拉按整条总线计算，禁止每个器件都无条件装一组上拉。
- 输出控制必须有外部安全偏置；不能依赖 MCU 启动后才产生安全电平。
- 所有网络名、极性、外设实例或初始化值变更，必须同时更新网表、firmware
  profile、本文和相关测试。

## 9. Bring-up 验收

- 核对 U19 精确料号、QFN pin 号、4 MB Flash 来源、2 MB PSRAM 运行时容量和构建配置。
- 示波器确认复位期间 `CE_TPS`、`P1_EN#`、`P1_CED/P2_CED` 与 `BLK` 电平。
- 验证两条 I2C 的上升时间、地址 allowlist、timeout 和 bus recovery。
- 验证共享 `INT` 可消歧，SW2303 仅在供电/POR 后访问。
- 验证显示 DMA、USB console、UART0 和蜂鸣器静音启动。
