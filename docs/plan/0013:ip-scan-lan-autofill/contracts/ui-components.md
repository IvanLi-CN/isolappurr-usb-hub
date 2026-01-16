# UI Components（Add device / IP scan）

本文件定义本计划新增/变更的前端领域形状（TypeScript 形状）。

## Shared domain shapes

```ts
export type LanCandidate = {
  cidr: string; // e.g. "192.168.1.0/24"
  label?: string; // e.g. "Wi-Fi (en0)"
  interface?: string; // e.g. "en0"
  ipv4?: string; // e.g. "192.168.1.23"
  primary?: boolean; // default route interface
};

export type DiscoverySnapshot = {
  mode: "service" | "scan";
  status: "idle" | "scanning" | "ready" | "unavailable";
  devices: DiscoveredDevice[];
  error?: string;

  scan?: { cidr: string; done: number; total: number };

  ipScan?: {
    expanded: boolean;
    expandedBy?: "user" | "auto";
    autoExpandAfterMs?: number;

    // New in this plan
    defaultCidr?: string; // when absent, UI keeps empty input
    candidates?: LanCandidate[];
  };
};
```

### Change notes

- Change: `DiscoverySnapshot.ipScan` **新增** `defaultCidr` 与 `candidates`。
- Compatibility: 旧 UI 若忽略新字段，不影响既有行为。

## `DeviceDiscoveryPanel` / IP scan input behavior

- 当输入框为空且 `defaultCidr` 存在：初次渲染时自动填充。
- 当 `candidates.length > 1`：提供下拉/自动完成建议（datalist 或等效组件）。
- 当用户已手动修改输入：不因候选刷新而覆盖。
