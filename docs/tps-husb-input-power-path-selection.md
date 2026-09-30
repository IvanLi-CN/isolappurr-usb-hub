# `tps-husb` 输入电源路径

事实来源为 [本版网表](../hardware/tps-husb/netlist.enet)，不适用于 `tps-fusb`
或 `tps-sw`。输入目标为 DC 6–28 V、USB 5–28 V、10 A；30 V 只作为极限
检查点。

| 路径 | 拓扑 | 控制边界 |
| --- | --- | --- |
| DC | U20 + Q2/Q3，`DCIN -> DCVS -> VSYS` | 双 NMOS 理想二极管及高侧关断；Q5 可将 U20 `EN/UVLO` 拉低 |
| USB | U25 + Q10，`PDIN -> VSYS` | 单 NMOS 理想二极管；反向阻断，正向体二极管仍导通 |

U20 pin 2/3=`DCIN`、pin 4=`DC_SW`、pin 5=`DC_OV`、pin 6=`DC_UVLO`、
pin 9=`VSYS`、pin 10/12=`DCVS`。R20=75 kΩ/R26=22 kΩ 是 UVLO
分压，R27=100 kΩ/R43=4.3 kΩ 是 OV 分压。U25 pin 2=`PDIN`、
pin 3/4/9/10/12=`VSYS`、pin 5=`GND`、pin 6=`PD_EN`、pin 8 NC；
R4=100 kΩ 将 `PD_EN` 上拉到 `PDIN`。U25 没有受控 HGATE，不能用其
EN/UVLO 对 USB 路执行正向硬断开。

`RN4` 的四组独立 100 kΩ、1% 电阻中，2–7 将 `DC_CE` 下拉至 GND，
3–6 将 `TPS_USB_C_VBUS_EN` 下拉，4–5 将 `CE_TPS` 上拉至 `3V3`，
1–8 未使用。`DC_CE` 接 U19 GPIO35 和 Q5 gate；Q5 drain 接
`DC_UVLO`、source 接 GND。

| `DC_CE` | Q5 / DC 路 | USB 路 |
| --- | --- | --- |
| Low 或 MCU 高阻 | Q5 关；U20 依 UVLO/OV 自动工作 | 独立理想二极管路径 |
| High | Q5 导通，U20 受控关断 | 仍可从 `PDIN` 向 `VSYS` 供电 |

GPIO35 不得在 DC-only 运行时误置 High，否则可能切断自身供电并复位，
随后因下拉默认态重新启动。固件必须先建立 Low 输出锁存再启用输出，
仅在 USB 合同及供电足以维持 `VSYS` 时允许关闭 DC。双输入情况下即使
两路均可供电，也不得仅根据该 GPIO 推断哪一路承担电流。

归档阶段尚未完成温升、漏电、浪涌、极限电压、热插拔与 brownout 波形
验证；PD 协商不能代替电气保护或反向电流测试。
