# USB-C 下行通道路由切换实现状态

## 当前覆盖

- 固件：已实现 `P1_ESP/GPIO5` route 输出、`P2_CED` 断开-切换-恢复序列、HTTP/USB JSONL route 设置队列、双键长按横向菜单、`MODE` 两步确认切换和屏幕/提示音反馈。
- EEPROM：已实现独立 device settings record，空/坏记录默认 `MCU` / `Upgrade` 且不自动回写。
- HTTP / USB JSONL API：已实现 route 状态返回与 `mcu|usb_c` 设置入口，成功响应绑定 EEPROM 写入成功。
- Web UI / Storybook：已实现设置页 `Normal` / `Upgrade` 二段控件、runtime transport 调用、Storybook 状态与交互覆盖。
- 视觉证据：已生成 Storybook canvas 证据并写入 `SPEC.md`。

## 验证命令

- `cargo check --bin isolapurr-usb-hub`
- `USB_HUB_WIFI_SSID=test USB_HUB_WIFI_PSK=testpassword cargo check --bin isolapurr-usb-hub --features net_http`
- `cd web && bun run check && bun run build && bun run build-storybook`

## 关联 PR

- 待创建。
