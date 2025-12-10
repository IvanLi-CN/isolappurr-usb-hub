# IsolaPurr USB Hub

IsolaPurr USB Hub 是一个带 USB‑C 上行口、一个 USB‑C 下行口和两个 USB‑A 下行口的有源 USB 集线器/供电模块，重点特性是：

- 上行：USB‑C 口（数据 + 供电），使用 **CH334P** 做 USB2.0 Hub 控制。  
- 下行 USB‑A ×2：每个口用一颗 **URB2405S‑3WR3** 隔离 DC/DC 模块独立供电，实现数据与电源隔离。  
- 下行 USB‑C ×1：使用 **CH224Q + TPS55288 + SW2303** 实现 USB‑PD 受电与 3.3–21 V 可调输出（PPS/AVS 能力由 SW2303 侧控制）。  
- 电源输入：
  - 来自主机的 USB‑C 上行口，通过 **CH224Q** 争取更高功率 PD 档位；  
  - 来自 DC5025 圆孔直流口（12–24 V 输入）；  
  通过两个理想二极管实现双路电源 OR‑ing，自动择优供电。

本仓库将包含完整的原理图、PCB、固件以及相关文档与数据手册的 Markdown 版本。

## 目录结构

当前主要目录：

- `docs/datasheets/`  
  - `ch224q-datasheet.md` – CH224Q/CH224A/CH224K/CH224D/CH221K 的官方手册 Markdown 版。  
  - `urb2405s-3wr3-datasheet.md` – URB/URA‑3WR3 3 W 隔离 DC/DC 模块手册 Markdown 版（基于 Hi‑Link HLK‑URB_S‑3WR3）。  
  - `urb2405s-6wr3-datasheet.md` – URB/URA‑6WR3 6 W 隔离 DC/DC 模块手册摘要（基于 MORNSUN URB_S‑6WR3 系列）。  
  - `tps55288-datasheet.md` – TI TPS55288 Buck‑Boost 转换器手册 Markdown 版。  
  - `images/` – 上述数据手册中引用的本地图片资源。

后续会补充：

- `hardware/` – 原理图与 PCB（KiCad / Altium 等，视实际选型而定）。  
- `firmware/` – 如需 MCU/I²C 控制（例如对 TPS55288/CH224Q 进行动态调压和状态读取）。  
- `mechanical/` – 外壳及 3D 模型（若有）。

## 开发与文档约定

- 项目中 **不保存 PDF 数据手册**，统一转为 Markdown + 本地图片，放在 `docs/datasheets/`。  
- 如需新增器件，请优先将数据手册转换为 Markdown，并在 README 中补充说明。  
- 提交信息遵循 conventional commits 规范，例如：  
  - `docs: add markdown datasheets`  
  - `feat: add upstream power mux schematic`

## 状态

目前仓库处于早期文档准备阶段，已完成主要电源与协议芯片的数据手册整理，后续会逐步补充原理图和 PCB 设计。
