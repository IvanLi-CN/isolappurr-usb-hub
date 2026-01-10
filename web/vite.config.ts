import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(() => {
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const base = process.env.GITHUB_PAGES === "true" && repo ? `/${repo}/` : "/";

  return {
    base,
    plugins: [react(), tailwindcss()],
  };
});
