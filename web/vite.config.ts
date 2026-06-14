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

  const explicitBase = process.env.VITE_BASE;
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const base = explicitBase
    ? normalizeBase(explicitBase)
    : process.env.GITHUB_PAGES === "true" && repo
      ? `/${repo}/`
      : "/";

  return {
    base,
    plugins: [
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
          navigateFallback: `${base}index.html`,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" && url.protocol.startsWith("http"),
              handler: "NetworkFirst",
              options: {
                cacheName: "isolapurr-navigations",
                networkTimeoutSeconds: 2,
              },
            },
          ],
        },
      }),
    ],
  };
});
