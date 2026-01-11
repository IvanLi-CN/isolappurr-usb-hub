# Config

本文件冻结 DaisyUI 自定义主题（tokens）与主题切换规则。

## DaisyUI themes

- Theme names:
  - `isolapurr`（light, default）
  - `isolapurr-dark`（dark, prefers-color-scheme: dark）

> 实现建议：在 `web/src/index.css` 使用 DaisyUI v5 的 `@plugin "daisyui/theme"` 方式定义主题；并通过 `data-theme="<theme>"` 应用在 `html`（或 `body`）上。

## Theme switch behavior

- `system`：不显式设置 `data-theme`，让 DaisyUI `--prefersdark` 生效（跟随系统深浅色）。
- `isolapurr`：显式设置 `data-theme="isolapurr"`。
- `isolapurr-dark`：显式设置 `data-theme="isolapurr-dark"`。

## Token guidelines (design rules)

- `primary`：用于主 CTA（Add Device / Apply / Power toggle 等）。
- `primary` 不应过度饱和/过浓：建议使用“柔和的蓝紫”（periwinkle/indigo）以适配长时间监控页面；通过 `hover/active` 与 `shadow` 表达强调，而不是把底色做得刺眼。
- `accent`：用于高亮/选中态（选中设备、当前 tab）。
- `success/warning/error/info`：仅用于状态表达（在线、忙碌、错误、提示）。
- `base-*`（背景/卡片）：应尽量“中性”（低饱和/低色相偏移），避免出现明显的蓝灰/脏灰导致卡片观感不佳；推荐通过更强的 `border` / `shadow` 体现层级，而不是用重色面。
- 避免在 card 内再铺一层“彩色/有色底”的子卡片（尤其是浅蓝灰）；子区域优先使用 `bg-base-100` + `border` 区分，必要时再用 `bg-base-200` 做轻微层级。
- 禁用按钮（disabled）不应通过极低 opacity 让文字“消失”；应保持标签可读（建议 `text-base-content/60` 左右），同时通过轻微去饱和与禁用光标表达不可交互。
- 组件圆角：
  - `--radius-box`: `0.75rem`（卡片、modal）
  - `--radius-field`: `0.5rem`（button、input、tab）
  - `--radius-selector`: `0.5rem`（badge、toggle）

## Suggested theme values (example)

> 下面的数值是建议口径（可在实现阶段微调，但要保持“同名 token 含义不变”）。

```css
@plugin "daisyui";

@plugin "daisyui/theme" {
  name: "isolapurr";
  default: true;
  prefersdark: false;
  color-scheme: light;

  --color-base-100: oklch(99% 0.005 250);
  --color-base-200: oklch(97.5% 0.006 250);
  --color-base-300: oklch(94.5% 0.01 250);
  --color-base-content: oklch(21% 0.02 250);

  --color-primary: oklch(62% 0.12 250);
  --color-primary-content: oklch(98% 0.01 250);
  --color-accent: oklch(70% 0.17 200);
  --color-accent-content: oklch(15% 0.02 200);
  --color-neutral: oklch(32% 0.03 250);
  --color-neutral-content: oklch(97% 0.01 250);

  --color-info: oklch(68% 0.14 240);
  --color-info-content: oklch(98% 0.01 240);
  --color-success: oklch(70% 0.16 145);
  --color-success-content: oklch(98% 0.01 145);
  --color-warning: oklch(82% 0.14 85);
  --color-warning-content: oklch(20% 0.03 85);
  --color-error: oklch(62% 0.20 25);
  --color-error-content: oklch(98% 0.01 25);

  --radius-selector: 0.5rem;
  --radius-field: 0.5rem;
  --radius-box: 0.75rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}

@plugin "daisyui/theme" {
  name: "isolapurr-dark";
  default: false;
  prefersdark: true;
  color-scheme: dark;

  --color-base-100: oklch(18% 0.012 250);
  --color-base-200: oklch(15% 0.012 250);
  --color-base-300: oklch(12% 0.012 250);
  --color-base-content: oklch(92% 0.01 250);

  --color-primary: oklch(74% 0.10 250);
  --color-primary-content: oklch(15% 0.02 250);
  --color-accent: oklch(78% 0.12 200);
  --color-accent-content: oklch(14% 0.02 200);
  --color-neutral: oklch(30% 0.02 250);
  --color-neutral-content: oklch(92% 0.01 250);

  --color-info: oklch(74% 0.12 240);
  --color-info-content: oklch(15% 0.02 240);
  --color-success: oklch(76% 0.14 145);
  --color-success-content: oklch(14% 0.02 145);
  --color-warning: oklch(86% 0.12 85);
  --color-warning-content: oklch(20% 0.03 85);
  --color-error: oklch(72% 0.16 25);
  --color-error-content: oklch(16% 0.02 25);

  --radius-selector: 0.5rem;
  --radius-field: 0.5rem;
  --radius-box: 0.75rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}
```
