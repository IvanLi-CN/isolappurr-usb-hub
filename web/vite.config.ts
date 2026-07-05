import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
  const publicUrl = (path: string): string =>
    siteOrigin ? `${siteOrigin}${base}${path}` : `${base}${path}`;

  return {
    base,
    plugins: [
      {
        name: "isolapurr-html-meta",
        transformIndexHtml: (html) =>
          html.replaceAll(
            "%SOCIAL_PREVIEW_IMAGE_URL%",
            publicUrl("brand/github-social-preview.png"),
          ),
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "favicon.ico",
          "icons/isolapurr-mark.svg",
          "icons/isolapurr-mark-mono.svg",
          "icons/apple-touch-icon.png",
          "icons/pwa-192.png",
          "icons/pwa-512.png",
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
              src: "icons/pwa-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icons/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icons/maskable-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "icons/maskable-512.png",
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
          globIgnores: ["**/brand/isolapurr-product-poster.png"],
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
  };
});
