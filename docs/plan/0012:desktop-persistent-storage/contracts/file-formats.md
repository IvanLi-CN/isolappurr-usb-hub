# File formats（Desktop local storage）（#0012）

本文件冻结 Desktop 本地持久化存储的 on-disk 数据格式（用于设备列表与桌面端设置）。

## 1. Location

- Base dir：`directories::ProjectDirs::config_dir()`
  - 复用 Desktop 既有 `last_port` 的目录选择逻辑（见实现中的 `project_dirs()`）。
  - 目标：跨 `gui/tray/open/serve` 模式一致，且不随 localhost 端口变化而变化。
- File name：`storage.json`
- Full path：`<config_dir>/storage.json`

## 2. Encoding

- UTF-8 JSON（object）
- 写入建议采用原子路径（同目录临时文件 → `rename`）

## 3. Schema (JSON shape)

```ts
export type DesktopStorageV1 = {
  schema_version: 1;
  devices: StoredDevice[];
  settings: DesktopSettings;
  meta?: {
    migrated_from_localstorage_at?: string; // ISO8601
  };
};

export type StoredDevice = {
  id: string;
  name: string;
  baseUrl: string; // normalized origin
  lastSeenAt?: string; // ISO8601
};

export type DesktopSettings = {
  theme?: "isolapurr" | "isolapurr-dark" | "system";
};
```

## 4. Validation rules

- `schema_version`：必须为 `1`；未知版本按“不可用/需升级”处理（实现阶段需明确策略：拒绝/备份后清空/提示）。
- `devices[*].baseUrl`：必须为 `http(s)` URL 且存储为 `origin`。
- `devices[*].id/name/baseUrl`：均为非空字符串（trim 后）。
- 允许向后兼容：
  - 新增字段必须可选；删除字段必须有迁移策略（通过 `schema_version` 演进）。

## 5. Corruption / recovery

当文件不可读（不存在/权限不足/JSON 解析失败）：

- App 启动不得失败（按空存储继续）。
- 建议策略（实现阶段冻结）：
  - 若 JSON 解析失败：将原文件移动为 `storage.corrupt.<timestamp>.json`（同目录），然后初始化新的空存储。
  - UI 可通过 storage API 暴露“存储损坏/已重置”的可读提示与恢复入口。

