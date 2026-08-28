# `tps-fusb` MCU 使用规范

本文是 `tps-fusb` variant 的 ESP32-S3 资源、引脚、外设初始化和所有权规范。
其硬件事实以 [`hardware/tps-fusb/netlist.enet`](../hardware/tps-fusb/netlist.enet)
为准；该网表是设计基线，尚未完成 PCB、BOM、生产贴装或固件验证。

## 1. 适用范围与状态

| 项目 | 本版合同 |
| --- | --- |
| Hardware variant | `tps-fusb`（网表已归档，待硬件与固件验证） |
| MCU | `ESP32-S3FH4R2(U19)` |
| 封装 | QFN-56-EP，7 mm x 7 mm，0.4 mm pitch |
| 网表证据 | [`hardware/tps-fusb/netlist.enet`](../hardware/tps-fusb/netlist.enet) 中 U19 |
| 规范来源 | [`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md) |
| PD 输入/输出 | FUSB302B sink PHY / FUSB302B source PHY + TPS55288 |
| 固件 | 尚未建立 `tps-fusb` 独立 profile |

`ESP32-S3FH4R2` 是裸片而非模组。RF、40 MHz 晶体、`CHIP_PU`、供电去耦和
exposed pad 都是板级责任。`tps-sw` 与 `tps-fusb` 必须使用独立编译期
firmware profile 和镜像，不得运行时猜测硬件 variant。

## 2. 固定资源与板级前提

- U19 的封装内 Flash/PSRAM 占用 `SPICS1`、`SPIHD`、`SPIWP`、`SPICS0`、
  `SPICLK`、`SPIQ` 和 `SPID` 路径；package pin 28、30 至 35 不分配为普通
  GPIO。
- package pin 37 `SPICLK_P` 可复用为 `GPIO47`，当前网表连接 `LED_TPS`；
  package pin 36 `SPICLK_N/GPIO48` 保留，不由本 profile 使用。
- GPIO0、GPIO3、GPIO45、GPIO46 受 strapping 约束；GPIO46 仅输入。GPIO39/40
  被第二条 I2C 使用，因此外部 PAD-JTAG 不可作为本 variant 的调试接口。
- GPIO19/20 固定为原生 USB 数据路径；UART0 使用 GPIO43/44。调试接口不得
  获得电源路径 GPIO 的写权限。
- TPS62933 `U3` 的 `EN` 在本网表中浮空，使芯片按自身默认行为启动以支持低压
  冷启动；`tps-sw` 的 `R4/R5=330k/56k` EN 分压不适用于本 variant。

## 3. MCU 资源预算

| 资源 | 引脚 / 初始配置 | 网络与成员 | 约束 |
| --- | --- | --- | --- |
| `I2C0` | GPIO39/40，400 kHz async | `SDA2/SCL2`: U10 FUSB302B input、U14 TPS55288、U17 INA226、U21 EEPROM、U23 TMP112 | 静态 allowlist、短事务和 timeout；占用 PAD-JTAG |
| `I2C1` | GPIO8/9，400 kHz async | `SDA/SCL`: U11 FUSB302B output、U13 INA226 | 静态 allowlist、短事务和 timeout |
| GPIO IRQ `INT` | GPIO7，AnyEdge，高阻输入 | U11 `INT_N`、U13 `Alert`、U14 `FB/INT` | 开漏共享；候选来源跨 I2C0/I2C1 |
| GPIO IRQ `INT2` | GPIO38，AnyEdge，高阻输入 | U10 `INT_N`、U17 `Alert`、U23 `ALERT` | 开漏共享；全部来源在 I2C0 |
| `ADC1_CH0` | GPIO1，高阻、无数字上下拉 | `VIN_DC_SENSE` | 11 dB、校准、滤波和滞回 |
| `SPI2` | GPIO10 至 GPIO14 | `DC/MOSI/SCLK/CS/RES` | GC9307，Mode 0，40 MHz |
| `LEDC` | GPIO21 | `BUZZER` | LS timer0/channel0，启动静音 |
| LED control | GPIO47，推挽输出 High | `LED_TPS` | 低有效；High=关，Low=同步点亮 |
| `USB_DEVICE` | GPIO19/20 | `USB_D-/USB_D+` | 原生 USB，不复用 |
| `UART0` | GPIO43/44 | `U0TX/U0RX` | 调试接口 |

## 4. GPIO 引脚分配总表

“初始配置”描述 firmware 接管 GPIO 后必须建立的状态；它不能替代外部上拉、
下拉、gate 偏置或保护电路。网络名按当前网表保留，未连接引脚不代表可跨版本
自由复用。

| Package Pin | MCU pin | 网络/功能 | 方向与初始配置 | 用途与注意事项 |
| ---: | --- | --- | --- | --- |
| 5 | GPIO0 | `BTNR` | 输入，内部上拉，低有效 | [STRAP] 右键；复位时不得持续拉低 |
| 6 | GPIO1 | `VIN_DC_SENSE` | ADC1_CH0，高阻、无数字上下拉 | DC 输入 1:11 分压采样 |
| 7 | GPIO2 | `P2_CED` | 推挽输出；由 profile 建立安全路由 | USB-C 数据开关；外部默认下拉 |
| 8 | GPIO3 | NC | 不初始化 | [STRAP] 保留 |
| 9 | GPIO4 | `P1_CED` | 推挽输出；由 profile 建立安全路由 | USB-A 数据开关；外部默认下拉 |
| 10 | GPIO5 | `P1_ESP` | 推挽输出；由 profile 建立安全路由 | USB 数据路由选择；外部默认下拉 |
| 11 | GPIO6 | `R41 -> LEDD` | 高阻输入、无内部上下拉 | CH318T sideband ready 采样，不得驱动 LEDD |
| 12 | GPIO7 | `INT` | 高阻输入、AnyEdge | 3.3 V 开漏共享中断，跨总线服务 |
| 13 | GPIO8 | `SDA` / I2C1 SDA | I2C 开漏 | U11、U13 |
| 14 | GPIO9 | `SCL` / I2C1 SCL | I2C 开漏 | U11、U13 |
| 15 | GPIO10 | `DC` | 推挽输出，初始 Low | GC9307 data/command |
| 16 | GPIO11 | `MOSI` | SPI2 输出 | GC9307 |
| 17 | GPIO12 | `SCLK` | SPI2 输出 | GC9307，40 MHz |
| 18 | GPIO13 | `CS` | 推挽输出，初始 High | GC9307 chip select |
| 19 | GPIO14 | `RES` | 推挽输出，初始 High | GC9307 reset |
| 21 | GPIO15 | `BLK` | 推挽输出，初始 High | 背光低有效，先关闭 |
| 22 | GPIO16 | `P1_EN#` | 推挽输出，初始 High | USB-A 电源低有效，先关闭 |
| 23 | GPIO17 | `P1_FAULT` | 输入 | 低有效故障 |
| 24 | GPIO18 | `R33 -> UP0_PG` | 高阻输入、无内部上下拉 | 高有效 sideband fault 采样 |
| 25 | GPIO19 | `USB_D-` | USB peripheral | 原生 USB |
| 26 | GPIO20 | `USB_D+` | USB peripheral | 原生 USB |
| 27 | GPIO21 | `BUZZER` | 初始 Low，再交给 LEDC | 默认静音 |
| 37 | GPIO47 / `SPICLK_P` | `LED_TPS` | 推挽输出，初始 High | 低有效同步 LED 视觉组 |
| 38 | GPIO33 | `BTNL` | 输入，内部上拉，低有效 | 左键 |
| 39 | GPIO34 | `VIN_EN` | 推挽输出，初始 Low | 输入总使能；Low=两路均不主动增强 |
| 40 | GPIO35 | `VIN_SEL` | 推挽输出，初始 Low | 0=DC，1=USB；仅 `VIN_EN=0` 时改变 |
| 41 | GPIO36 | `TPS_USB_C_VBUS_EN` | 推挽输出，初始 Low | 输出 PMOS gate 控制；Low=关闭 |
| 42 | GPIO37 | `CE_TPS` | 推挽输出，初始 High | 经 NMOS 拉低 TPS EN/UVLO，High=TPS 硬关闭 |
| 43 | GPIO38 | `INT2` | 高阻输入、AnyEdge | 3.3 V 开漏共享中断 |
| 44 | GPIO39 / MTCK | `SDA2` / I2C0 SDA | I2C 开漏 | U10、U14、U17、U21、U23；占用 PAD-JTAG |
| 45 | GPIO40 / MTDO | `SCL2` / I2C0 SCL | I2C 开漏 | U10、U14、U17、U21、U23；占用 PAD-JTAG |
| 47 | GPIO41 / MTDI | NC | 不初始化 | 保留/PAD-JTAG |
| 48 | GPIO42 / MTMS | NC | 不初始化 | 保留/PAD-JTAG |
| 49 | GPIO43 / U0TXD | `U0TX` | UART0 TX | 调试输出 |
| 50 | GPIO44 / U0RXD | `U0RX` | UART0 RX | 调试输入 |
| 51 | GPIO45 | NC | 不初始化 | [STRAP] 保留 |
| 52 | GPIO46 | NC | 仅输入、不初始化 | [STRAP] 保留，禁止输出用途 |

## 5. I2C、告警与协议约束

两颗 FUSB302B 使用相同的固定 I2C 地址，因此不能放到同一物理总线。I2C0 和
I2C1 必须各自维持 allowlist，禁止地址扫描。

- `INT` 触发后，ISR 只置 dirty flag。任务上下文先服务 `U11/U13`（I2C1），
  同时必须服务 `U14`（I2C0）；任一设备都可能将 `INT` 保持为低。
- `INT2` 触发后，任务上下文检查 `U10/U17/U23`（I2C0）。
- TPS55288 的 `FB/INT` 接入 `INT`，因此 firmware MUST 保持 TPS 使用内部
  输出反馈模式。将其切换为外部反馈会把共享告警线变成反馈输入，属于禁止配置。
- FUSB302B 的 `VCONN` 由 `3V3` 供电。每个端口须在 PCB 中保留就近去耦和
  足够的 VCONN bulk；该要求仍需通过 layout/硬件验证。
- FUSB302B 的 VBUS 正常工作范围上限为 21 V。`VIN_DC` 的 28 V 额定输入
  不得被解释为 USB-PD VBUS 可接受 28 V；firmware 不得协商或接受超过 21 V
  的 USB-PD/PPS 合同。

## 6. 上电初始化顺序

1. 在其他外设初始化前建立 `VIN_EN=Low`、`VIN_SEL=Low`、
   `TPS_USB_C_VBUS_EN=Low`、`CE_TPS=High`、`LED_TPS=High`。
2. 配置 GPIO1 ADC、GPIO7/38 高阻中断输入和按键输入，读取初始输入、外部
   `VBUS_TPS` 与按键状态。
3. 初始化 I2C0/I2C1，使用静态 allowlist 确认可访问设备；不执行总线扫描。
4. 运行 input-power-selector：先测量并验证，再使用不少于 5 ms 的
   break-before-make 选择 DC 或 USB。
5. 将 TPS55288 置于 OE off/安全 setpoint。输出 source attach 与 PD contract
   完成前，不得启动 TPS 或接通 `VOUT_TPS -> VBUS_TPS`。
6. 最后初始化显示、DMA、USB、UART、LEDC 和上层任务。

## 7. 所有权与禁止事项

| 模块 | 独占资源 | 允许的跨模块接口 |
| --- | --- | --- |
| Input PD policy | U10 FUSB302B | 发布 USB contract/测量状态 |
| Input power selector | ADC1_CH0、GPIO34/35 | 接收候选输入状态，执行唯一切换序列 |
| Output PD policy | U11 FUSB302B | 提交 VBUS/电流请求 |
| TPS coordinator | U14 TPS55288、GPIO37 | 接收输出设定请求 |
| VBUS gate controller | GPIO36 | 接收 source 状态机开关请求 |
| Interrupt coordinator | GPIO7/38 | 唤醒对应 I2C 服务，不直接切电源 |
| Indicator controller | GPIO47 | 只控制 `LED_TPS` 视觉组 |

- PD policy、ADC sampler 和 UI 不得绕过 input-power-selector 写 GPIO34/35。
- 不得将推挽输出并入 `INT` 或 `INT2`；每条告警线只允许一个上拉预算。
- 不得仅因 I2C 为 400 kHz 就认定 PD timing 满足。必须验证 IRQ latency、
  task scheduling、bus recovery 和最坏事务占用。
- EDA LED 占位料不构成生产 BOM。实装前必须替换为经过批准的颜色、Vf、亮度
  bin 和封装料号，详见 [`tps-fusb` 硬件设计](tps-fusb-hardware-design.md)。

## 8. Bring-up 验收

- [ ] U19 料号、封装内 Flash/PSRAM、build target 与本 profile 一致。
- [ ] Package Pin、GPIO 与网络逐脚符合本文；尤其 GPIO33=`BTNL`、
  GPIO34=`VIN_EN`、GPIO35=`VIN_SEL`、GPIO47=`LED_TPS`。
- [ ] GPIO34/36/37/47 在复位、高阻、下载模式和崩溃重启期间保持安全状态。
- [ ] 两条 I2C 的地址、上拉、上升时间、timeout、bus recovery 和并发压力通过验证。
- [ ] `INT` 的跨总线来源与 `INT2` 的 I2C0 来源都可被可靠消歧。
- [ ] ADC 在 9 V、24 V、28 V 完成校准、容差和噪声验证。
- [ ] 验证 DC/USB 同插、掉电、重协商、至少 5 ms break-before-make、外部 VBUS
  与受控反灌；TPS `VOUT` 不得超过 25 V。
- [ ] 每颗实装 LED 的料号、极性、光色与限流设计已通过生产前检查。
