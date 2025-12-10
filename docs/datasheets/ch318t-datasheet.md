# 高速 USB 信号隔离延长器控制芯片 CH318

手册  
版本：1.1  
https://wch.cn

# 1、概述

CH318 是高速 USB 信号隔离和传输距离延长控制芯片，支持电容耦合或者网络变压器耦合，不但实现了对 USB 信号的隔离，同时实现了对 USB 信号的实时中转和传输距离延长。此外，CH318 芯片自身带有 USB HUB 功能，上行端口支持 USB2.0 高速，下行端口支持 USB2.0 高速 480Mbps、全速 12Mbps和低速 1.5Mbps。CH318 可以用于高速 USB 信号隔离、隔离 HUB、延长 HUB 等。

下图为其一般应用框图。

![](images/e854702c438edf0437f0bb1ff9ce18e6f6fe3fce1f87f03e5ec3b748cd4bc8d2.jpg)  
图 1-1 CH318 一般应用框图

# 2、特点

上位机模式提供 1 个 USB2.0 下行端口，下位机模式提供 2 个 USB2.0 下行端口，向下兼容USB1.1 协议规范

$\bullet$ 支持 480Mbps 高速、12Mbps 全速和 1.5Mbps 低速 USB 传输

$\bullet$ 支持 USB 控制传输、批量传输、中断传输、同步/等时传输

$\bullet$ 同一芯片可配置为上位机模式和下位机模式，分别连接 USB-Host 主机和 USB-Device 设备

$\bullet$ 搭配 CH339 芯片，可以实现 USB 读卡器、USB 转 SPI、转 JTAG、转 I2C 等多种接口的隔离

$\bullet$ 支持连接状态指示

$\bullet$ 内置电容耦合驱动电路和网络变压器耦合驱动电路

$\bullet$ 纯硬件解决方案，对 USB 协议完全实时和透明，不需要额外安装任何驱动程序，支持各种包含 USB 接口的系统

提供晶体振荡器，支持外部时钟输入，内置 PLL 为 USB PHY 提供 480MHz 时钟

$\bullet$ 上行端口内置 1.5KΩ上拉电阻，下行端口内置 USB Host 主机所需下拉电阻，外围精简

$\bullet$ USB 接口引脚具有 $6 \mathsf { k V }$ 增强 ESD 性能，Class 3A

$\bullet$ 工业级温度范围： $- 4 0 { \sim } 8 5 ^ { \circ } \mathsf { C }$

$\bullet$ 提供 TSSOP20 封装形式

# 3、封装

<table><tr><td></td><td colspan="2">CH318T</td><td></td></tr><tr><td>1 2</td><td rowspan="6">DMX DPX XO</td><td rowspan="6">NC</td><td>20 19</td></tr><tr><td></td><td>NC</td></tr><tr><td>3</td><td>18 NC</td></tr><tr><td>4 5</td><td>17 NC</td></tr><tr><td>xI AVDDK 6</td><td>16 VDD33 15</td></tr><tr><td colspan="2">DMU</td><td>GND</td></tr><tr><td colspan="2">7</td><td rowspan="4">DVDDK LED/MODE</td><td>14</td></tr><tr><td>8</td><td>DPU DM2</td><td>13</td></tr><tr><td>9</td><td>DP2</td><td>12 I03</td></tr><tr><td>10</td><td>I01</td><td>11</td></tr><tr><td colspan="2"></td><td>I02</td><td></td></tr></table>

表 3-1 封装说明  

<table><tr><td rowspan=1 colspan=1>$</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=2>3AE</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>iT</td></tr><tr><td rowspan=1 colspan=1>TSS0P20</td><td rowspan=1 colspan=1>4.4*6. 5mm</td><td rowspan=1 colspan=1>0.65mm</td><td rowspan=1 colspan=1>25. 6mi l</td><td rowspan=1 colspan=1> 20 </td><td rowspan=1 colspan=1>CH318T</td></tr></table>

# 4、引脚

表 4-1 引脚定义  

<table><tr><td colspan="1" rowspan="1">3A</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">IE </td></tr><tr><td colspan="1" rowspan="1">1</td><td colspan="1" rowspan="1">DMX</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">K</td></tr><tr><td colspan="1" rowspan="1">2</td><td colspan="1" rowspan="1">DPX</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">KE</td></tr><tr><td colspan="1" rowspan="1">6</td><td colspan="1" rowspan="1">DMU</td><td colspan="1" rowspan="1">USB</td><td colspan="1" rowspan="1">:USB2.0D;L:1#TUSB20</td></tr><tr><td colspan="1" rowspan="1">7</td><td colspan="1" rowspan="1">DPU</td><td colspan="1" rowspan="1">USB</td><td colspan="1" rowspan="1">USB20D+;T:1#T□USB20 D+</td></tr><tr><td colspan="1" rowspan="1">8</td><td colspan="1" rowspan="1">DM2</td><td colspan="1" rowspan="1">USB</td><td colspan="1" rowspan="1">2#T□USBD</td></tr><tr><td colspan="1" rowspan="1">9</td><td colspan="1" rowspan="1">DP2</td><td colspan="1" rowspan="1">USB</td><td colspan="1" rowspan="1">2#T□USBD+</td></tr><tr><td colspan="1" rowspan="1">3</td><td colspan="1" rowspan="1">XO</td><td colspan="1" rowspan="1">0</td><td colspan="1" rowspan="1">-E</td></tr><tr><td colspan="1" rowspan="1">4</td><td colspan="1" rowspan="1">XI</td><td colspan="1" rowspan="1">I</td><td colspan="1" rowspan="1">—E</td></tr><tr><td colspan="1" rowspan="1">16</td><td colspan="1" rowspan="1">VDD33</td><td colspan="1" rowspan="1">P</td><td colspan="1" rowspan="1">3.3V,1uF</td></tr><tr><td colspan="1" rowspan="1">5</td><td colspan="1" rowspan="1">AVDDK</td><td colspan="1" rowspan="1">P</td><td colspan="1" rowspan="1">1uF</td></tr><tr><td colspan="1" rowspan="1">14</td><td colspan="1" rowspan="1">DVDK</td><td colspan="1" rowspan="1">P</td><td colspan="1" rowspan="1">0.1uF</td></tr><tr><td colspan="1" rowspan="1">15</td><td colspan="1" rowspan="1">GND</td><td colspan="1" rowspan="1">P</td><td colspan="1" rowspan="1">Λ</td></tr><tr><td colspan="1" rowspan="1">13</td><td colspan="1" rowspan="1">LED/MODE</td><td colspan="1" rowspan="1">51/0</td><td colspan="1" rowspan="1">LED:MMODE:T51T</td></tr><tr><td colspan="1" rowspan="1">10</td><td colspan="1" rowspan="1">101</td><td colspan="1" rowspan="1">51/0</td><td colspan="1" rowspan="1">/+TTTIT10 101 I1F</td></tr><tr><td colspan="1" rowspan="1">11</td><td colspan="1" rowspan="1">102</td><td colspan="1" rowspan="1">51/0</td><td colspan="1" rowspan="1">/+</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">C </td></tr></table>

注 1：引脚类型缩写解释：  
USB=USB 信号引脚；  
I=3.3V 信号输入；  
O=3.3V 信号输出；  
5I= 额定 3.3V 信号输入，支持 5V 耐压；  
P= 电源或地。

上位机模式下为输出引脚；下位机模式下为输入引脚。  
如果下位机模式的 IO2 引脚输入高电平，则上位机模式对应的 IO2 引脚输出高电平；如果下位机模式的 IO2 引脚输入低电平，则上位机模式对应的 IO2 引脚输出低电平。

12 IO3 5I/O 上行的通用 I/O 边带信号，引脚映射有数十毫秒级延时。  
上位机模式下为输出引脚；下位机模式下为输入引脚。  
如果下位机模式的 IO3 引脚输入高电平，则上位机模式对应的 IO3 引脚输出高电平；如果下位机模式的 IO3 引脚输入低电平，则上位机模式对应的 IO3 引脚输出低电平

17 、18 、19 、20 NC - 保留引脚，禁止连接

# 5、功能说明

## 5.1 模式配置

CH318 芯片通过配置引脚 LED/MODE，可配置为上位机模式和下位机模式，分别连接 USB-Host 主机和 USB-Device 设备。

表 5-1 CH318 模式配置说明  

LED/MODE 通过 5.1K 电阻下拉到 GND 下位机模式，下行口连接 USB-Device 设备  
悬空或通过 5.1K 电阻上拉到 VDD33 上位机模式，上行口连接 USB-Host 主机

## 5.2 常规功能说明

CH318 芯片工作在上位机模式时，U 端子端口 D+、D- 为 USB HUB 的上行端口，连接到 PC 的 USB Host 主机。  
工作在下位机模式时，U1 端子和 D2 端子两个 USB 端口为 USB HUB 的下行端口，分别连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB 设备。

图 5-1 CH318 USB 端口功能 参考示意图

![](images/cbb9e864d0e5eb18b8851b9b04afb1cdf2eafabcb77b95bf40c75266a597fd6f.jpg)

CH318 芯片上位机模式下的 DMU 和 DPU 引脚 可配置为USB Hub 的下行端口或者上行端口，具体管脚 功能由芯片内部的 OTP 固化，不同版本的芯片功能 如下所示，芯片丝印参考第七章。

表 5-2 CH318 DMU 和 DPU 引脚功能示意图  

<table><tr><td colspan="1" rowspan="1">丝印</td><td colspan="1" rowspan="1">模式</td><td colspan="1" rowspan="1">功能</td></tr><tr><td colspan="1" rowspan="1">CH318T-A1XXN</td><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">上行端口</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">下位机模式</td><td colspan="1" rowspan="1">1#下行端口</td></tr><tr><td colspan="1" rowspan="1">CH318T-A1X2N</td><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">上行端口</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">下位机模式</td><td colspan="1" rowspan="1">1#下行端口</td></tr><tr><td colspan="1" rowspan="1">CH318T-A102N</td><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">上行端口</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">下位机模式</td><td colspan="1" rowspan="1">1#下行端口</td></tr><tr><td colspan="1" rowspan="1">CH318T-A202N</td><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">下行端口</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">下位机模式</td><td colspan="1" rowspan="1">1#下行端口</td></tr></table>

采用 CH318T-A2 型号芯片时，CH318 芯片上位机模式下，U 插口默认为 USB HUB 的下行 端口，可连接 USB 键盘、USB 鼠标、U 盘、打印机等 通用 USB 设备；由 DP2/DM2 构成的 USB 端口为 USB HUB 的上行端口，连接到 PC 的 USB Host。

采用 CH318T-A1 型号芯片时，CH318 芯片上位机 模式下，U 端子端口 D+、D- 和 D2 端子端口 DP2、DM2 为 USB HUB 的下行端口，分别连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB 设备，其中 2 个下行 口 LED 显示规则如下所示。

表 5-3 CH318T-A1XXN 两个下行口 LED 显示规则示意图  

<table><tr><td colspan="1" rowspan="1">模式</td><td colspan="1" rowspan="1">功能</td><td colspan="1" rowspan="1">LED/MODE 功能</td></tr><tr><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">2个下行端口</td><td colspan="1" rowspan="1">下行端口对应 LED</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr></table>

工作在下位机模式时，上图中 U 端子端口 D+、D- 和 D2 端子端口 DP2、DM2 为 USB HUB 的下行端口，分别连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB 设备，其中 2 个下行口 LED 显示规则如下所示。

表 5-4 CH318T-A1X2N 两个下行口 LED 显示规则示意图  

<table><tr><td colspan="1" rowspan="1">模式</td><td colspan="1" rowspan="1">功能</td><td colspan="1" rowspan="1">LED/MODE 功能</td></tr><tr><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">2个下行端口</td><td colspan="1" rowspan="1">2#下行端口对应 LED</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr></table>

工作在上位机模式时，上图中 U 端子端口 D+、D- 为 USB HUB 的下行端口，连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB 设备；由 DP2/DM2 构成的 USB 端口为 USB HUB 的上行端口，连接到 PC 的 USB Host，其中 2 个下行口 LED 显示规则如下所示。

表 5-5 CH318T-A102N 两个下行口 LED 显示规则示意图  

<table><tr><td colspan="1" rowspan="1">模式</td><td colspan="1" rowspan="1">功能</td><td colspan="1" rowspan="1">LED/MODE 功能</td></tr><tr><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">1个下行端口,1个上行端口</td><td colspan="1" rowspan="1">下行端口对应 LED</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr></table>

工作在下位机模式时，上图中 U 端子端口 D+、D- 和 D2 端子端口 DP2、DM2 为 USB HUB 的下行端口，分别连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB 设备，其中 2 个下行口 LED 显示规则如下所示。

表 5-6 CH318T-A202N 两个下行口 LED 显示规则示意图  

<table><tr><td colspan="1" rowspan="1">模式</td><td colspan="1" rowspan="1">功能</td><td colspan="1" rowspan="1">LED/MODE 功能</td></tr><tr><td colspan="1" rowspan="1">上位机模式</td><td colspan="1" rowspan="1">1个下行端口,1个上行端口</td><td colspan="1" rowspan="1">LINK</td></tr><tr><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1"></td></tr></table>

工作在下位机模式时，上图中 U 端子端口 D+、D- 和 D2 端子端口 DP2、DM2 为 USB HUB 的下行端口，分别连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB 设备，其中 2 个下行口 LED 显示规则如下所示。

CH318 芯片具有自恢复电源启动功能，本身不需要复位电路，当在系统中需要复位 CH318 芯片时，可将 AVDDK 和 DVDDK 引脚 通过 NPN 或者 MOS 管构成复位电路。AVDDK 和 DVDDK 引脚是 CH318 内部电源引脚，通过此引脚可外接退耦电容。  
如外部需要更长的电源保持，请适量加大退耦电容。

CH318 芯片具有连接状态指示功能，在上位机模块中为输入，在下位机模块中为输出。  
具体功能为：当两端 CH318 芯片之间建立 USB 连接时，下位机模块中的 CH318 芯片 IO1 引脚会输出高电平，驱动 IO1 的输出 LED 常亮；环路映射有几十毫秒的延时。当上位机与下位机之间的 USB 链路断开时，下位机端的 CH318 芯片 IO1 引脚输出低电平，驱动 IO1 LED 熄灭。

为节省 IO 引脚，在上位机模块端中 IO2 和 IO3 引脚可以不接 LED。  
当有应用需求时，上位机模块端的 IO2 和 IO3 亦可输出状态，和下位机模块端的 IO2 和 IO3 有几百毫秒的映射延时。具体映射关系如下图所示。

![](images/a8f5d332acb1cf851f6b09bf0c3b0f1965eb74d3aa5e4dcc94d19b753c4dad88.jpg)

采用 CH318 的系统建议使用 20MHz 晶体，电容配合晶体负载选择，可参考下面推荐值进行设计。其中，晶体两侧对地电容 C5、C6 诺使用贴片电容，建议不要轻易减小电容值。如果要调整，可将 C5 削小到 15pF，但 C6 不可小于 30pF。

表 5-7 CH318 晶体振荡器推荐参数  

<table><tr><td colspan="1" rowspan="1">晶体频率</td><td colspan="1" rowspan="1">负载电容</td><td colspan="1" rowspan="1">串联电阻</td><td colspan="1" rowspan="1">晶体精度</td><td colspan="1" rowspan="1">C5(典型值)</td><td colspan="1" rowspan="1">C6(典型值)</td></tr><tr><td colspan="1" rowspan="1">20MHz</td><td colspan="1" rowspan="1">20pF</td><td colspan="1" rowspan="1">4.7MΩ</td><td colspan="1" rowspan="1">50PPM</td><td colspan="1" rowspan="1">30pF</td><td colspan="1" rowspan="1">30pF</td></tr><tr><td colspan="1" rowspan="1">20MHz</td><td colspan="1" rowspan="1">12pF</td><td colspan="1" rowspan="1">4.7MΩ</td><td colspan="1" rowspan="1">50PPM</td><td colspan="1" rowspan="1">18pF</td><td colspan="1" rowspan="1">30pF</td></tr></table>

图 5-3 CH318 采用晶体振荡器形式的电路示意图

![](images/6c88ac12f0c9e95c79c0a423ad4d5840e5433fc4bd235abd32eca7de3a726aa6.jpg)

CH318 芯片也可以通过输入外部时钟方式来替代晶体振荡器，此时外部时钟需要满足以下条件：  
时钟频率：20MHz±100PPM；  
信号幅度：VDD33±10%；  
输入信号类型：方波；  
信号输入：XI 引脚；  
XO 引脚悬空。

图 5-4 CH318 采用外部时钟输入的电路示意图

![](images/3e3e6a7ff7d9e84b4b23998d4235163cca531ff0fffefcd57c4e0ffb0bf07a40.jpg)

图 5-5 CH318 LED/MODE 引脚内部逻辑关系示意图

![](images/2900fcde2917de6f6b51b25bfc0e701a3613bafd95ab9f06e3ed3fcd12f7d61d.jpg)

J1 短接，J 味边  
M  
P1、P2 为 HUB 下行端的 USB 口

## 5.3 系统工作模式

CH318 芯片通过配置引脚 LED/MODE，可配置为上位机模式和下位机模式。

CH318 上位机模式和下位机模式的配置电路如图所示。  
当 LED/MODE 引脚通过 5.1K 电阻悬空或者上拉到 VDD33 时，CH318 芯片工作在上位机模式；  
当 LED/MODE 引脚通过 5.1K 电阻下拉到 GND 时，CH318 芯片工作在下位机模式。

![](images/e13427c3efdce1a88f0b8f14e7eee332853e23d66d89374d3eff8721041ed634.jpg)  
图 5-7 CH318 上下位机模式配置示意图

# 6、电气参数

T=25℃，除非另有说明

在连续运行超过最大额定值范围时可能会降低设备的可靠性。器件并非设计用于超过额定值范围内工作。

表 6-1 极限参数  

<table><tr><td colspan="1" rowspan="1">参数</td><td colspan="1" rowspan="1">符号</td><td colspan="1" rowspan="1">最小值</td><td colspan="1" rowspan="1">典型值</td><td colspan="1" rowspan="1">最大值</td><td colspan="1" rowspan="1">单位</td></tr><tr><td colspan="1" rowspan="1">工作温度范围</td><td colspan="1" rowspan="1">T</td><td colspan="1" rowspan="1">-40</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">85</td><td colspan="1" rowspan="1">℃</td></tr><tr><td colspan="1" rowspan="1">存储温度范围</td><td colspan="1" rowspan="1">Ts</td><td colspan="1" rowspan="1">-40</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">125</td><td colspan="1" rowspan="1">℃</td></tr><tr><td colspan="1" rowspan="1">管脚输入电压范围</td><td colspan="1" rowspan="1">V</td><td colspan="1" rowspan="1">-0.3</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">5.5</td><td colspan="1" rowspan="1">V</td></tr></table>

表 6-2 推荐工作条件  

<table><tr><td colspan="1" rowspan="1">参数</td><td colspan="1" rowspan="1">符号</td><td colspan="1" rowspan="1">最小值</td><td colspan="1" rowspan="1">典型值</td><td colspan="1" rowspan="1">最大值</td><td colspan="1" rowspan="1">单位</td></tr><tr><td colspan="1" rowspan="1">工作温度范围</td><td colspan="1" rowspan="1">T</td><td colspan="1" rowspan="1">-40</td><td colspan="1" rowspan="1"></td><td colspan="1" rowspan="1">85</td><td colspan="1" rowspan="1">℃</td></tr><tr><td colspan="1" rowspan="1">工作电压范围</td><td colspan="1" rowspan="1">VDD</td><td colspan="1" rowspan="1">3.0</td><td colspan="1" rowspan="1">3.3</td><td colspan="1" rowspan="1">3.6</td><td colspan="1" rowspan="1">V</td></tr></table>

表 6-3 DC 特性参数  

<table><tr><td rowspan=1 colspan=1>参数</td><td rowspan=1 colspan=1>符号</td><td rowspan=1 colspan=2>条件</td><td rowspan=1 colspan=1>最小值</td><td rowspan=1 colspan=1>典型值</td><td rowspan=1 colspan=1>最大值</td><td rowspan=1 colspan=1>单位</td></tr><tr><td rowspan=1 colspan=1>I/O 引脚工作电压范围</td><td rowspan=1 colspan=1>V1/0</td><td rowspan=1 colspan=2></td><td rowspan=1 colspan=1>-0.3</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>VDD33+0.3</td><td rowspan=1 colspan=1>V</td></tr><tr><td rowspan=1 colspan=1>I/O 引脚输入漏电流</td><td rowspan=1 colspan=1>11</td><td rowspan=1 colspan=1>0<VI<3.6</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>-10</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>10</td><td rowspan=1 colspan=1>μA</td></tr><tr><td rowspan=1 colspan=1>I/O 引脚输入低电平</td><td rowspan=1 colspan=1>VIL</td><td rowspan=1 colspan=3></td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>0.8</td><td rowspan=1 colspan=1>V</td></tr><tr><td rowspan=1 colspan=1>I/O 引脚输入高电平</td><td rowspan=1 colspan=1>VIH</td><td rowspan=1 colspan=3>M</td><td rowspan=1 colspan=1>2.0</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>VDD33</td><td rowspan=1 colspan=1>V</td></tr><tr><td rowspan=1 colspan=1>输出低电平</td><td rowspan=1 colspan=1>VoL</td><td rowspan=1 colspan=2>1F</td><td rowspan=1 colspan=1>5mA</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>0.4</td><td rowspan=1 colspan=1>0.6</td><td rowspan=1 colspan=1>V</td></tr><tr><td rowspan=1 colspan=1>输出高电平</td><td rowspan=1 colspan=1>VoH</td><td rowspan=1 colspan=2>F</td><td rowspan=1 colspan=1>5mA</td><td rowspan=1 colspan=1>VDD33-0.6</td><td rowspan=1 colspan=1>VDD33-0.4</td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1>V</td></tr><tr><td rowspan=1 colspan=1>上拉电阻值</td><td rowspan=1 colspan=1>Rpu</td><td rowspan=1 colspan=3></td><td rowspan=1 colspan=1>30</td><td rowspan=1 colspan=1>40</td><td rowspan=1 colspan=1>55</td><td rowspan=1 colspan=1>kΩ</td></tr><tr><td rowspan=1 colspan=1>下拉电阻值</td><td rowspan=1 colspan=1>RpD</td><td rowspan=1 colspan=3>T</td><td rowspan=1 colspan=1>30</td><td rowspan=1 colspan=1>40</td><td rowspan=1 colspan=1>55</td><td rowspan=1 colspan=1>kΩ</td></tr><tr><td rowspan=1 colspan=1>LVR</td><td rowspan=1 colspan=1>Vivr</td><td rowspan=1 colspan=3></td><td rowspan=1 colspan=1>2.4</td><td rowspan=1 colspan=1>2.9</td><td rowspan=1 colspan=1>3.2</td><td rowspan=1 colspan=1>V</td></tr></table>

# 7、封装

说明：尺寸标注的单位是 mm（毫米）。  
引脚中心间距是标称值，没有误差，除此之外的尺寸误差不大于 $\pm 0 . 2 \mathsf { m m }$ 。

# 7.1 TSSOP20

![](images/4535ace2e8ec8ab5bc415d21480d2b1d25cc32cc2c41363e850be81af752b0e9.jpg)

![](images/1ce6e4fd0a88c7f3cdf7c1154b2760ce4e12717528510103d7284e7405244782.jpg)

# 8、应用

# 8.1 网络变压器隔离的 USB 延长器

![](images/a9af4f449cebebc7fd303683a1c4409b64ce132c854438188758fb0d1f9e9ff1.jpg)  
图 8-1 CH318T 变压器隔离/延长应用参考电路图

上图是采用网络变压器耦合隔离的 USB 延长器，上半部分为上位机模块，下半部分为下位机模块，两者通过网线进行连接。JP1 悬空则 CH318T 工作在上位机模式，P2 作为 HUB 的上行口，连接到计算机或者其它 USB-Host 主机，P1 作为 HUB 下行口，连接 USB 键盘、USB 鼠标、U 盘、打印机等通用 USB设备；JP1 短接则 CH318T 工作在下位机模式，P1 和 P2 均作为 HUB 下行口。U2 为 5V 转 3.3V 的线性稳压芯片(LDO)，尽量选择宽范围输入、低压差的型号，建议不低于 500mA 负载能力且有散热机制，

以便保证输出能稳定在 3.3V。

U3_1 为上位机模块端的网络变压器，U3_2 为下位机模块端的网络变压器，如果延长距离比较短或者同一块板子隔离应用，则可以省略 1 个网络变压器。P3_1 和 P3_2 为用于连接上位机模块和下位机模块的 RJ45 接口。

上位机模块与下位机模块之间通常使用普通网线（5类或者超5类非屏蔽双绞线）连接，对于有隔离需求的应用，连接线仅仅包括DPX和DMX两根差分信号线，不包括电源线和地线。对于不需要隔离仅延长的应用，普通的8芯网线，可以两根用于差分信号线，4根用于地线，2根用于电源线。电源线可以用于同时提供 $+ 5 \mathsf { V }$ 电源到USB设备端，但是受网线直流电阻的压降影响，尤其是当USB设备消耗电流较多时，在USB设备端的实际电源电压通常会不足5V，甚至有个别USB设备可能会因此而不能正常工作，那么就需要对下位机提供独立供电。

在 HUB 下行端口 USB 设备带电热插拔的瞬间，动态负载可能使 5V 电压瞬时跌落，进而可能产生LVR 低压复位，从而出现整个 HUB 断开再连接的现象。改进方法： $\textcircled{1}$ 在规范允许范围内加大 5V 电源的电解电容（加大图示 C10 容量），缓解跌落； $\textcircled{2}$ 加大 HUB 芯片电源输入端的电容（加大图示 C2 或C7 容量，例如 22uF）； $\textcircled{3}$ 增强 5V 供电能力或改为自供电，另外，提升 USB 线材质量也会改善供电能力。

设计 PCB 时需考虑实际工作电流承载能力，5V 和 P2 及各端口 GND 走线路径的 PCB 尽可能宽，如有过孔则建议多个并联。USB 口的 ${ \mathsf { D } } +$ 和 D-信号线按高速 USB 规范贴近平行布线，保证特性阻抗，尽量在两侧提供地线或者覆铜，减少来自外界的信号干扰。

建议 5V 加过压保护器件，建议所有 USB 信号加 ESD 保护器件，例如 CH412K，其 VCC 应接 3.3V。

# 8.2 电容隔离的 USB 延长器

![](images/5c82f198b3a31ef4c33c542e520b051fedb386ecad15d9b92394bd1721fd280c.jpg)  
图 8-2 电容隔离/延长应用示意图

CH318 芯片可以使用两只容量为 $0 . 0 2 2 \mathsf { u F } { \sim } 0 . 4 7 \mathsf { u F }$ 的高频电容器以差分方式传输信号并隔离直流电压，隔离电压由电容器的耐压决定，建议选择耐压不低于 2KV 的 0.1uF 高压高频电容。

采用电容方案隔离时，仅需将图 8-1 中的变压器更换成 2 对高频电容即可，其它部分不变。如果只是隔离、无需延长，则可以省略 1 对电容。

# 8.3 更多 USB 口或其它接口隔离延长

如果某些应用需要隔离或延长更多的 USB 口，比如 7 个 USB 口，则下位机模块芯片可以替换成开启 2 线延长隔离功能的 CH338F 芯片，该芯片带有 7 个下行 USB 口。

如果某些应用需要隔离或延长更多的 USB 口以及其它接口，比如网口、SDIO 读卡器接口、SPI 接

口、JTAG 接口、UART 接口、I2C 接口等，则下位机模块芯片可以替换成开启 2 线延长隔离功能的 CH339W芯片，该芯片集成了 7 口 USB HUB、USB 百兆以太网、USB 高速 SD 读卡器和 USB 转 SPI、USB 转 JTAG、USB 转 UART、USB 转 I2C 接口等功能。

