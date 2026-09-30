# `tps-husb` 网表检查清单

网表：[hardware/tps-husb/netlist.enet](../../hardware/tps-husb/netlist.enet)。
来源：用户提供的只读 `Netlist_Schematic1_1_2026-09-30.enet`；两者
SHA-256 均为
`4dbb26d6a1d2dcb6d5ce968be72b4398958bac0b4d9f2919fa8c7dfe0e94ff2a`。
旧版 `hardware/tps-fusb/`、`hardware/tps-sw/` 不属于此归档。

## 可从网表确认

- U10=HUSB311BLA 输入 sink TCPC；U11=FUSB302B 输出 source PHY。
- U20 LM74800-Q1 驱动 Q2/Q3 DC 双 NMOS；U25 LM74800-Q1 驱动
  Q10 USB 单 NMOS。U25 HGATE 未连接，Q10 正向体二极管不能硬关断。
- U20 UVLO 分压 R20/R26=75 kΩ/22 kΩ，OV 分压 R27/R43=100 kΩ/4.3 kΩ；
  U25 `PD_EN` 由 R4=100 kΩ 上拉到 `PDIN`。
- U20/U25 的 CAP–VS 分别有 C96/C98=100 nF；VS–GND 分别有
  C100/C99=100 nF。U20 `C` 接 `DCVS`，U25 `C` 接 `VSYS`。
- RN4=4 x 100 kΩ、1%：2–7=`DC_CE` 下拉，3–6=输出 VBUS 使能下拉，
  4–5=`CE_TPS` 上拉，1–8 未使用。GPIO35 的 High=关闭 DC。
- U15 是 5 位调试接口，含 BOOT0、CHIP_EN；TPS R28/R30 仍为
  200 kΩ/36 kΩ，本版没有修改它们。

## 尚不能由网表证明

- 10 A 路径的铜箔、连接器、MOSFET SOA、热设计和器件选型裕量。
- 6/5 V 冷启动、28 V 额定目标、30 V 极限、双输入切换及反向漏电
  在 PCB 和实物上的结果。
- USB-PD 输入/输出协议、HUSB311BLA 固件驱动、合同失效与异常恢复。
- 生产 BOM、贴装资料和与本版匹配的独立固件镜像。
