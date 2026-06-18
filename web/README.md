# Isolapurr USB Hub Web

React SPA (Vite + React + TypeScript) for the mock dual-port dashboard, designed to be deployed on GitHub Pages.

## Pages

- `/` — Dashboard (multi-device grid)
- `/devices/:deviceId` — Device details (Overview)
- `/devices/:deviceId/info` — Device details (Hardware)
- `/about` — About

## Theme

- Built-in themes: `isolapurr` (light), `isolapurr-dark` (dark), `system` (follow OS)
- Preference is persisted in `localStorage` under `isolapurr_usb_hub.theme`

## Quick start

- Install: `bun install`
- Dev server: `bun dev` (default: `http://127.0.0.1:45173`)
- Icons: `bun run icons` regenerates favicon, Apple, PWA, maskable, and desktop-ready PNG assets from `src/assets/brand/isolapurr-mark.svg`
- Storybook: `bun run storybook` (default: `http://127.0.0.1:46006`)
- Preview: `bun run preview` (default: `http://127.0.0.1:45175`)

Icon regeneration requires `rsvg-convert` from librsvg and Python Pillow (`python3 -m pip install Pillow`).

## Review tips

- Storybook includes viewport presets for quick layout checks:
  - `Isolapurr Mobile (390×844)`
  - `Isolapurr Desktop (1440×900)`
- Storybook is reserved for reusable components and composite surfaces. Route-
  level verification stays on the real SPA pages, the only formal owner-facing
  demo route contract is `?demo=true|false` on those same SPA pages, and
  `web/src/pages/*.stories.*` is not an allowed pattern in this repository. See
  [`docs/specs/kvbq9-web-demo-surface-policy/SPEC.md`](../docs/specs/kvbq9-web-demo-surface-policy/SPEC.md)
  for the repository policy.

## Quality gates

- `bun run check`
- `bun run build`
- `bun run test:unit`
- `bun run build-storybook && bun run test:storybook`
- `bun run build && bun run test:e2e`
