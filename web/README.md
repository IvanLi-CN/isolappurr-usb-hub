# Isolapurr USB Hub Web

React SPA (Vite + React + TypeScript) for the mock dual-port dashboard, designed to be deployed on GitHub Pages.

## Pages

- `/` — Dashboard (multi-device grid)
- `/devices/:deviceId` — Device details (Overview)
- `/devices/:deviceId/info` — Device details (Hardware)
- `/devices/:deviceId/power` — Device details (Power)
- `/about` — About
- `*` — Standalone 404 fallback with Dashboard/About recovery links

## Theme

- Built-in themes: `isolapurr` (light), `isolapurr-dark` (dark), `system` (follow OS)
- Preference is persisted in `localStorage` under `isolapurr_usb_hub.theme`

## Quick start

- Install: `bun install`
- Dev server: `bun dev` (default: `http://127.0.0.1:45173`)
- Brand assets: `bun run brand-assets` regenerates the product poster, GitHub Social preview, and PNG logo from the source images in `src/assets/brand/`
- Icons: `bun run icons` regenerates brand assets plus favicon, Apple, regular PWA, maskable PWA, desktop-ready PNG assets, and the Tauri source PNG from `src/assets/brand/isolapurr-mark.svg`
- Storybook: `bun run storybook` (default: `http://127.0.0.1:46006`)
- Preview: `bun run preview` (default: `http://127.0.0.1:45175`)

Brand and icon regeneration requires `rsvg-convert` from librsvg, Python Pillow (`python3 -m pip install Pillow`), and `cargo tauri icon` for the desktop bundle assets.
Production social preview metadata uses an absolute image URL on GitHub Pages. For other hosts, set `VITE_SITE_ORIGIN=https://example.com` during `bun run build`.

## Install icon contract

- `web/src/assets/brand/isolapurr-mark.svg` is the single source of truth for all install icons.
- `web/src/assets/brand/isolapurr-logo.svg` is the source logo. `web/public/brand/isolapurr-logo.png` is the transparent PNG export for surfaces that need a raster logo.
- `web/src/assets/brand/product-poster-source.png` and `web/src/assets/brand/github-social-preview-source.png` are the source marketing images. `bun run brand-assets` exports `web/public/brand/isolapurr-product-poster.png`, `web/public/brand/github-social-preview.png`, and `.github/social-preview.png`.
- Regular install icons (`favicon`, `pwa-*`, `apple-touch-icon`, `desktop-*`, `tauri-source-1024.png`) are exported with a visible safe zone for Chrome/macOS, Apple touch surfaces, and Tauri desktop bundles.
- Maskable icons (`maskable-*`) stay full-bleed for Android/PWA maskable install slots.
- `bun run icons` also refreshes `desktop/src-tauri/icons/*` through `cargo tauri icon`; do not hand-edit the generated desktop PNG/ICNS/ICO assets.
- `bun run test:icons` validates the geometry contract and marketing image dimensions: regular icons keep padding, maskable icons stay edge-aligned, desktop PNG assets are not transparent placeholders, and poster/social preview exports keep their expected aspect ratios.

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

- `bun run icons && bun run test:icons`
- `bun run check`
- `bun run build`
- `bun run test:unit`
- `bun run build-storybook && bun run test:storybook`
- `bun run build && bun run test:e2e`
