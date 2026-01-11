# UI Components

本文件冻结关键 UI 组件的 props 与跨组件共享的数据形状（TypeScript 形状）。

## Shared domain shapes

```ts
export type PortId = "port_a" | "port_c";

export type TelemetryStatus = "ok" | "not_inserted" | "error" | "overrange";

export type PortTelemetry = {
  status: TelemetryStatus;
  voltage_mv: number | null;
  current_ma: number | null;
  power_mw: number | null;
  sample_uptime_ms?: number; // from device; no RTC required
};

export type PortControlState = {
  power_enabled?: boolean;
  data_connected?: boolean; // read-only; reflects current link state if available
  replugging?: boolean; // action in progress (UI/local or from device)
  busy?: boolean;
};

export type ConnectionState = "online" | "offline" | "unknown";

export type DeviceConnection = {
  state: ConnectionState;
  last_ok_at?: string; // ISO8601 (derived in UI)
  last_error?: string; // user-readable short message
};

export type DeviceSummary = {
  id: string;
  name: string;
  baseUrl: string;
  connection: DeviceConnection;
  ports: Record<PortId, { label: string; telemetry: PortTelemetry; state: PortControlState }>;
};
```

## `DeviceSummaryCard`

用于 Dashboard 网格展示单个设备的摘要信息与快捷操作。

```ts
export type DeviceSummaryCardProps = {
  device: DeviceSummary;
  onOpenDetails: (deviceId: string) => void;
  onTogglePower: (deviceId: string, portId: PortId) => void;
  onDataReplug: (deviceId: string, portId: PortId) => void;
};
```

## `PortSummary`

```ts
export type PortSummaryProps = {
  portId: PortId;
  label: string; // "USB-A" | "USB-C"
  telemetry: PortTelemetry;
  state: PortControlState;
  onTogglePower?: () => void;
  onDataReplug?: () => void;
};
```

### `PortSummary` interaction notes

- `Power`：当 `state.power_enabled === true` 且用户尝试执行 “Power Off” 时，必须在按钮旁显示确认气泡；用户确认后才调用 `onTogglePower()`。
- 确认气泡的内容应单行垂直居中；确认按钮使用 DaisyUI 最小尺寸（`btn-xs`）。
- 确认气泡为“浮层”样式（popover）：宽度按内容自适应，并带小箭头指向触发按钮；不应做成卡片内整行条幅。
- 确认气泡必须是 overlay：显示/隐藏不得改变卡片布局（no layout shift）。
- 确认气泡必须有不透明背景（例如 `bg-base-200` 或 `bg-base-100`），不可使用透明背景；需配合 `shadow-*` 与合适的 `z-index`（例如 `z-50`）保证可见且覆盖在卡片内容之上。
- 当操作被禁用（例如设备 `offline/unknown`）时：按钮需呈现 disabled 状态（不可点击），但**必须保持按钮文案可读**（避免用过低 opacity 把 “Power/Replug” 变得看不清）。
- `Replug`：一次性触发，无二次确认（除非后续另行冻结）。

## `ThemeSelector`

```ts
export type ThemeId = "isolapurr" | "isolapurr-dark" | "system";

export type ThemeSelectorProps = {
  value: ThemeId;
  onChange: (next: ThemeId) => void;
};
```

## Modal overlay rules

- 所有 modal / dialog 必须使用全屏遮罩（覆盖 navbar/header + sidebar），避免“遮罩只盖内容区”的割裂感。
- 遮罩与弹窗应使用固定定位（`fixed inset-0`）与明确的层级（例如 `z-50`），确保不会被 header 的 `z-index` 覆盖。
