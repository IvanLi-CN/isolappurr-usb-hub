# Worktree Bootstrap 主题历史

> 这里记录主题局部生命周期、兼容性与必要背景；完整取舍保留在 `docs/adr/0003-worktree-bootstrap-contract.md`。

## Lifecycle / Compatibility

- 新增 `worktree-bootstrap` 主题，采用 slug-only canonical Spec。
- 自动路径与手动 strict repair 复用同一实现，保留不同失败语义。

## Replacements / Background

- 主题源于仓库原有 Lefthook commit hooks 与 fresh linked worktree 依赖缺失之间的维护空白。

## Related Changes

- `docs/adr/0003-worktree-bootstrap-contract.md`
- `./SPEC.md`
- `./IMPLEMENTATION.md`
