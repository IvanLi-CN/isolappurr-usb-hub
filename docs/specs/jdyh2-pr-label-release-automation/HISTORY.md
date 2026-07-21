# PR Label Driven Automatic Release 演进历史（#jdyh2）

> 这里记录会影响 Agent 理解“为什么一步步变成现在这样”的关键演进；单次任务流水账不放这里，规范正文仍以 `./SPEC.md` 为准。

## Decision Trace

- 2026-06-01: 引入 PR label 驱动的 release intent、集中式 Release workflow 与 release failure notifier。
- 2026-07-20: 把 stable release、默认 GitHub Pages 公开面和 release web asset 收束成单次 `web/dist` 构建合同，消除“release 已发、Pages 没切”的漂移。
- 2026-07-20: 把 `pages.yml` 改为 PR build + `release_tag` backfill 双路径；默认公开 Pages 面不再由普通 `push main` 直接部署。
- 2026-07-20: 把 required checks、`merge_group` 可见性与 `quality-gates` truth source 对齐，避免 workflow 路径过滤导致 required check 缺席。

## Key Reasons / Replacements

- 早期自动发布只保证“可以发 release”，没有冻结“哪个构建拥有默认公开站点”的合同，所以 stable 发布与 Pages 经常漂成两条线。
- 本次把 stable/public-site contract 纳入同一 spec，是因为这已经不只是 release automation，而是 owner-facing default surface 的正式交付边界。

## References

- `./SPEC.md`
- `./IMPLEMENTATION.md`
