# File formats

本文件冻结本计划新增/修改的持久化数据格式。

## `localStorage`: theme preference

- Key: `isolapurr_usb_hub.theme`
- Encoding: UTF-8 JSON（string）
- Schema:

```ts
export type ThemeId = "isolapurr" | "isolapurr-dark" | "system";
```

- Semantics:
  - `system`：跟随系统深浅色（由 DaisyUI `--prefersdark` 决定）。
  - 其余值：显式设置 `data-theme`。

