# USB-C 下行通道路由切换实现状态

## 当前覆盖

- 固件：已实现 `P1_ESP/GPIO5` route 输出、`P2_CED` 断开-切换-恢复序列、HTTP/USB JSONL route 设置队列、双键长按横向菜单、`MODE` 两步确认切换和屏幕/提示音反馈。
- EEPROM：已实现独立 device settings record，空/坏记录默认 `MCU` / `Upgrade` 且不自动回写。
- HTTP / USB JSONL API：已实现 route 状态返回与 `mcu|usb_c` 设置入口，成功响应绑定 EEPROM 写入成功。
- Web UI / Storybook：已实现设置页 `Normal` / `Upgrade` 二段控件、runtime transport 调用、Storybook 状态与交互覆盖。
- Port controls：端口卡片、缩略卡和 USB-C 侧栏共用二阶段按住控件；`Power` 保留各自的 power adapter，`Data link` 通过 capability-gated runtime `data_set` 变更真实 `data_connected` 状态。
- 控件可见反馈固定为一个实际状态图标；阶段、成功、失败、拒绝、禁用与外部变化通过按钮本体色调、背景方向、边框和动效表达，不在按钮中显示状态文字。动作标签限定为完整的 `Power` / `Data link`，不使用省略号或通过改变卡片布局腾出空间。
- Storybook 状态矩阵、三处产品入口 stories 与 Demo E2E 将上述设计契约作为回归测试：覆盖所有状态、pointer/touch/keyboard、click-only tooltip、桌面/移动、状态确认和 reduced-motion。
- 视觉证据：已生成 Storybook canvas 证据并写入 `SPEC.md`。

## 验证命令

- `cargo check --bin isolapurr-usb-hub`
- `USB_HUB_WIFI_SSID=test USB_HUB_WIFI_PSK=testpassword cargo check --bin isolapurr-usb-hub --features net_http`
- `cd web && bun run check && bun run build && bun run build-storybook`

## 关联 PR

- 待创建。
