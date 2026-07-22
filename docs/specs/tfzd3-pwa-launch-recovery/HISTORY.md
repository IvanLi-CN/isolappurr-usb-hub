# PWA 启动壳与启动恢复 演进历史（#tfzd3）

> 这里记录会影响 Agent 理解“为什么一步步变成现在这样”的关键演进；单次任务流水账不放这里，规范正文仍以 `./SPEC.md` 为准。

## Decision Trace

- 2026-07-19: 为已安装 PWA 新增独立于 React bundle 的启动壳，正式消除“冷启动先白屏”的空窗。
- 2026-07-19: 把启动故障恢复拆成两层：健康会话继续 `prompt` 更新，故障启动路径自动激活 `waiting` worker 并在必要时落入失败壳。
- 2026-07-19: 为 GitHub Pages 增加旧 hash 静态资源 retention 窗口，避免 stale `index.html` 立刻命中被删除 bundle。
- 2026-07-19: 追加 Storybook visual evidence 与 Playwright 回归，把白屏恢复做成可持续验证的合同。
- 2026-07-20: 为健康会话补主动更新检查调度层，固定触发时机为注册完成、回到前台、重新联网和 60 分钟轮询。
- 2026-07-20: 把 `Later` 行为冻结为“同一标签页会话内对同一候选更新只提示一次”，避免健康会话被重复打扰。
- 2026-07-20: 把 stable public deploy retention 从 `pages.yml` 收回到 `release.yml`，让 PWA 更新发现与 stable 发布面回到同一合同。
- 2026-07-22: 将 Pages 旧 hash retention 的 stable 历史源切到 GitHub Release web-dist 资产，避免线上 `asset-retention.json` 已被截断时继续丢弃仍在 14 天窗口内的旧入口资源。
- 2026-07-22: 线上 Chrome 安装态发现 `display-mode` 不一定命中 standalone；启动壳恢复逻辑改为健康时可隐藏、显式启动故障时必须可见，并在没有 `waiting` worker 时主动 `registration.update()`，避免旧 shell 崩溃后只能白屏，同时避免普通 browser 慢挂载被误判为 PWA 故障。
- 2026-07-22: 将 firmware flash workbench 明确收为 PWA 内页面合同；service worker precache 包含 release manifest 与 catalog JSON 元数据，但继续排除 `.bin` / `.elf` 固件镜像，避免安装态离线打开 `/flash` 时丢失 bundled release list。

## Key Reasons / Replacements

- 新增本 spec，是因为这次修复已经形成长期稳定的 PWA 启动恢复主题；继续只靠 `docs/web-ui-interaction-spec.md` 的概述条目无法承载启动壳、自愈状态机和发布 retention 的细粒度 contract。

## References

- `./SPEC.md`
- `./IMPLEMENTATION.md`
