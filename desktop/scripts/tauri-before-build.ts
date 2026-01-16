import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..");

const webDir = resolve(repoRoot, "web");
const webDistDir = resolve(webDir, "dist");
const desktopDistDir = resolve(desktopDir, "dist");
const desktopIndexHtml = resolve(desktopDistDir, "index.html");

const skipWebBuild = ["1", "true", "yes"].includes(
  (process.env.ISOLAPURR_SKIP_WEB_BUILD ?? "").toLowerCase(),
);

const webDistOverride = process.env.ISOLAPURR_WEB_DIST_DIR;
const effectiveWebDistDir = webDistOverride
  ? resolve(repoRoot, webDistOverride)
  : webDistDir;

function runOrThrow(cmd: string[], cwd: string) {
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(`Command failed (exit ${result.exitCode}): ${cmd.join(" ")}`);
  }
}

if (webDistOverride) {
  console.log("[tauri] Using prebuilt web dist:", effectiveWebDistDir);
} else if (skipWebBuild) {
  console.log("[tauri] ISOLAPURR_SKIP_WEB_BUILD=1; skipping web build");
} else {
  console.log("[tauri] Building web UI...");
  runOrThrow(["bun", "run", "build"], webDir);
}

console.log("[tauri] Syncing desktop/dist from web/dist...");
await rm(desktopDistDir, { recursive: true, force: true });
await mkdir(desktopDistDir, { recursive: true });
await cp(effectiveWebDistDir, desktopDistDir, { recursive: true });
await access(desktopIndexHtml);

console.log("[tauri] OK:", desktopIndexHtml);
