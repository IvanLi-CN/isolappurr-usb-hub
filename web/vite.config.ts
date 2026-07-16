import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = dirname(fileURLToPath(import.meta.url));
const installIconAssets = [
  "public/favicon.ico",
  "public/icons/isolapurr-mark.svg",
  "public/icons/apple-touch-icon.png",
  "public/icons/pwa-192.png",
  "public/icons/pwa-512.png",
  "public/icons/maskable-192.png",
  "public/icons/maskable-512.png",
];

const createInstallIconVersion = (): string => {
  const hash = createHash("sha256");
  for (const asset of installIconAssets) {
    hash.update(readFileSync(resolve(rootDir, asset)));
  }
  return hash.digest("hex").slice(0, 12);
};

// https://vite.dev/config/
export default defineConfig(() => {
  const normalizeBase = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return "/";
    }

    const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return withLeadingSlash.endsWith("/")
      ? withLeadingSlash
      : `${withLeadingSlash}/`;
  };
  const normalizeOrigin = (raw: string | undefined): string | undefined => {
    const trimmed = raw?.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  };

  const explicitBase = process.env.VITE_BASE;
  const [owner, repo] = process.env.GITHUB_REPOSITORY?.split("/") ?? [];
  const base = explicitBase
    ? normalizeBase(explicitBase)
    : process.env.GITHUB_PAGES === "true" && repo
      ? `/${repo}/`
      : "/";
  const explicitSiteOrigin = normalizeOrigin(process.env.VITE_SITE_ORIGIN);
  const githubPagesOrigin =
    process.env.GITHUB_PAGES === "true" && owner
      ? `https://${owner.toLowerCase()}.github.io`
      : undefined;
  const siteOrigin = explicitSiteOrigin ?? githubPagesOrigin;
  const installIconVersion = createInstallIconVersion();
  const versionedInstallIconPath = (path: string): string =>
    `${path}?v=${installIconVersion}`;
  const publicUrl = (path: string): string =>
    siteOrigin ? `${siteOrigin}${base}${path}` : `${base}${path}`;

  return {
    base,
    plugins: [
      {
        name: "isolapurr-html-meta",
        transformIndexHtml: (html) =>
          html
            .replaceAll(
              "%SOCIAL_PREVIEW_IMAGE_URL%",
              publicUrl("brand/github-social-preview.png"),
            )
            .replaceAll("%INSTALL_ICON_VERSION%", installIconVersion),
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        // Static install icons are versioned above; do not let the PWA assets
        // generator replace their manifest or HTML entries during the build.
        pwaAssets: {
          disabled: true,
        },
        includeAssets: [
          "favicon.ico",
          "icons/isolapurr-mark.svg",
          "icons/isolapurr-mark-mono.svg",
          "icons/apple-touch-icon.png",
          "icons/pwa-192.png",
          "icons/pwa-512.png",
          "icons/maskable-192.png",
          "icons/maskable-512.png",
          "brand/isolapurr-logo.png",
          "brand/github-social-preview.png",
        ],
        manifest: {
          id: base,
          name: "IsolaPurr USB Hub",
          short_name: "IsolaPurr",
          description:
            "A workbench console for discovering, configuring, and operating IsolaPurr USB Hub devices.",
          start_url: ".",
          scope: ".",
          display: "standalone",
          display_override: ["window-controls-overlay", "standalone"],
          orientation: "any",
          background_color: "#f6f7fb",
          theme_color: "#a6c9bd",
          categories: ["productivity", "utilities"],
          icons: [
            {
              src: versionedInstallIconPath("icons/pwa-192.png"),
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: versionedInstallIconPath("icons/pwa-512.png"),
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: versionedInstallIconPath("icons/maskable-192.png"),
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: versionedInstallIconPath("icons/maskable-512.png"),
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          globIgnores: [
            "**/brand/isolapurr-product-poster.png",
            "**/brand/isolapurr-product-render.png",
            "**/brand/isolapurr-product-render-full.png",
            "**/firmware/**/*",
          ],
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
  };
});
