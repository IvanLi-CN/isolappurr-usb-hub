# Isolapurr USB Hub Web

React SPA (Vite + React + TypeScript) for the mock dual-port dashboard, designed to be deployed on GitHub Pages.

## Pages

- `/` — Dashboard (multi-device grid)
- `/devices/:deviceId` — Device details (Overview)
- `/devices/:deviceId/info` — Device details (Hardware)
- `/devices/:deviceId/power` — Device details (Power)
- `/flash` — Standalone firmware flash workbench
- `/about` — About
- `*` — Standalone 404 fallback with Dashboard/About recovery links

Installed PWA cold starts now use a stable startup runtime from `web/public/boot-shell.js`. The startup shell lives in `web/index.html`, appears before the main React bundle mounts, auto-promotes a `waiting` service worker only for startup-failure recovery, actively calls `registration.update()` when failure happens before a waiting worker exists, and falls back to a failure shell with `Try again` / `Repair app` actions that reset service workers plus Cache Storage without clearing saved devices or theme state.

## Theme

- Built-in themes: `isolapurr` (light), `isolapurr-dark` (dark), `system` (follow OS)
- Preference is persisted in `localStorage` under `isolapurr_usb_hub.theme`

## Quick start

- Install: `bun install`
- Dev server: `bun dev` (default: `http://127.0.0.1:45173`)
- Firmware bundle refresh: `bun run bundle-firmware` (release-maintainer path; requires GitHub access plus local `espflash`)
- Brand assets: `bun run brand-assets` regenerates the product poster, the cropped standalone product render, the uncropped approved product render archive, the transparent product cutout export, GitHub Social preview, and PNG logo from the source images in `src/assets/brand/`
- Icons: `bun run icons` regenerates brand assets plus favicon, Apple, regular PWA, maskable PWA, desktop-ready PNG assets, and the Tauri source PNG from `src/assets/brand/isolapurr-mark.svg`
- Storybook: `bun run storybook` (default: `http://127.0.0.1:46006`)
- Preview: `bun run preview` (default: `http://127.0.0.1:45175`)

Brand and icon regeneration requires `rsvg-convert` from librsvg, Python Pillow (`python3 -m pip install Pillow`), and `cargo tauri icon` for the desktop bundle assets.
Production social preview metadata uses an absolute image URL on GitHub Pages. For other hosts, set `VITE_SITE_ORIGIN=https://example.com` during `bun run build`.

## PWA startup recovery and Pages retention

- `web/public/boot-shell.js` is the stable-path startup recovery runtime for installed PWA launches.
- `web/src/pwa/register.ts` keeps the healthy-session update UX in `prompt` mode; startup failure recovery is handled by the boot shell instead of forcing every update to auto-reload, and the boot shell keeps explicit failure observers active even when browser display-mode detection does not report standalone without treating ordinary browser mount delays as PWA launch failures.
- `bun run retain-pages-assets` builds `dist/asset-retention.json` and copies forward supported old hashed assets. In stable release jobs it prefers existing GitHub Release web-dist assets via `GITHUB_REPOSITORY` + `GITHUB_TOKEN`; runs without those credentials, or with an authenticated GitHub listing that has no matching web-dist assets yet, fall back to the live Pages site.
- Retention keeps the newest two releases or anything published in the last 14 days, whichever retains more versions.
- The retention bootstrap path can fall back to the live `sw.js` precache list when `asset-retention.json` does not exist yet on the deployed site.

## Bundled firmware releases

- `web/public/firmware/releases-manifest.json` is the checked-in offline/default manifest for local development and PR validation.
- Release builds replace that file at build time by running `tools/firmware-bundle/build-web-bundle.py`, which fetches the current non-draft GitHub Releases from `IvanLi-CN/isolappurr-usb-hub` and synthesizes merged `full_image` recovery assets when a legacy release only ships an ELF recovery artifact.
- The generated web bundle keeps the most recent 50 app-upgrade releases and only the latest stable plus latest prerelease recovery images.
- Firmware assets stay same-origin under `firmware/releases/**` and are fetched on demand by `/flash`; they are intentionally excluded from service-worker install-time precache.

## PWA install surface

- The app shell keeps a shared PWA install runtime for `beforeinstallprompt`, `appinstalled`, `display-mode`, and `window-controls-overlay`.
- When the browser exposes a native install prompt and the shell is not already installed, the global header shows an `Install app` CTA. The `/about` page always keeps the install guide plus a browser-menu fallback when no native prompt is available.
- Manifest shortcuts are fixed to the Dashboard (`/`) and Firmware flash workbench (`/flash`).
- Manifest screenshots live under `web/public/pwa/` and must come from stable owner-facing app-shell states, never from marketing renders.
- Refresh those screenshots with a running local preview/build host:
  - `bun run capture:pwa-screenshots -- --base-url http://127.0.0.1:45175`

## Install icon contract

- `web/src/assets/brand/isolapurr-mark.svg` is the single source of truth for all install icons.
- `web/src/assets/brand/isolapurr-logo.svg` is the source logo. `web/public/brand/isolapurr-logo.png` is the transparent PNG export for surfaces that need a raster logo.
- `web/src/assets/brand/product-poster-source.png`, `web/src/assets/brand/product-render-source.png`, `web/src/assets/brand/product-render-full-source.png`, `web/src/assets/brand/product-render-cutout-source.png`, and `web/src/assets/brand/github-social-preview-source.png` are the source marketing images. `bun run brand-assets` exports `web/public/brand/isolapurr-product-poster.png`, `web/public/brand/isolapurr-product-render.png`, `web/public/brand/isolapurr-product-render-full.png`, `web/public/brand/isolapurr-product-render-cutout.png`, `web/public/brand/github-social-preview.png`, and `.github/social-preview.png`.
- `isolapurr-product-render.png` remains the fixed `1774x887` brand slot export. `isolapurr-product-render-full.png` is the approved full-frame archive and must stay pixel-identical to `product-render-full-source.png`. `isolapurr-product-render-cutout.png` is the transparent cutout export used to keep poster and social-product refreshes aligned with the approved full render.
- Build-time HTML and manifest metadata append a shared content-hash query to install-facing icon URLs so Chrome/macOS PWA installs refetch icon assets when the artwork changes.
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
