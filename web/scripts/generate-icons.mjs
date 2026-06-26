import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/assets/brand/isolapurr-mark.svg");
const sourceMono = resolve(root, "src/assets/brand/isolapurr-mark-mono.svg");
const publicDir = resolve(root, "public");
const iconDir = resolve(publicDir, "icons");
const desktopRoot = resolve(root, "../desktop/src-tauri");
const desktopIconsDir = resolve(desktopRoot, "icons");
const paddedSourceSvg = resolve(iconDir, "isolapurr-mark-padded.svg");
const tauriSourcePng = resolve(iconDir, "tauri-source-1024.png");
const desktopKeep = new Set([
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.icns",
  "icon.ico",
]);

const PADDED_SCALE = 0.82;

const pngTargets = [
  ["favicon-16.png", 16, "padded"],
  ["favicon-32.png", 32, "padded"],
  ["favicon-48.png", 48, "padded"],
  ["pwa-192.png", 192, "padded"],
  ["pwa-512.png", 512, "padded"],
  ["maskable-192.png", 192, "full-bleed"],
  ["maskable-512.png", 512, "full-bleed"],
  ["apple-touch-icon.png", 180, "padded"],
  ["desktop-256.png", 256, "padded"],
  ["desktop-512.png", 512, "padded"],
  ["tauri-source-1024.png", 1024, "padded"],
];

await run("rsvg-convert", ["--version"]);
await run("python3", ["-c", "import PIL"]);

await mkdir(iconDir, { recursive: true });
await mkdir(desktopIconsDir, { recursive: true });
await copyFile(source, resolve(iconDir, "isolapurr-mark.svg"));
await copyFile(sourceMono, resolve(iconDir, "isolapurr-mark-mono.svg"));
await writeFile(paddedSourceSvg, await createPaddedSvg(source, PADDED_SCALE));

for (const [name, size, variant] of pngTargets) {
  const src = variant === "full-bleed" ? source : paddedSourceSvg;
  await run("rsvg-convert", [
    src,
    "--width",
    String(size),
    "--height",
    String(size),
    "--format",
    "png",
    "--output",
    resolve(iconDir, name),
  ]);
}

await rm(resolve(publicDir, "favicon.ico"), { force: true });
await run("python3", [
  "-c",
  [
    "from PIL import Image",
    "from pathlib import Path",
    `root=Path(${JSON.stringify(iconDir)})`,
    "img=Image.open(root/'favicon-48.png')",
    `img.save(${JSON.stringify(resolve(publicDir, "favicon.ico"))}, sizes=[(16,16),(32,32),(48,48)])`,
  ].join(";"),
]);

await run(
  "cargo",
  ["tauri", "icon", tauriSourcePng, "--output", desktopIconsDir],
  {
    cwd: desktopRoot,
  },
);
await pruneDesktopIcons();

async function createPaddedSvg(svgPath, scale) {
  const svg = await readFile(svgPath, "utf8");
  const body = svg
    .replace(/^<svg[^>]*>\s*/u, "")
    .replace(/\s*<\/svg>\s*$/u, "");
  const translate = ((1 - scale) * 256) / 2;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title desc">',
    `  <g transform="translate(${translate} ${translate}) scale(${scale})">`,
    body
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

async function pruneDesktopIcons() {
  const entries = await readdir(desktopIconsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (desktopKeep.has(entry.name)) {
      continue;
    }
    await rm(resolve(desktopIconsDir, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd,
    });
    child.on("error", (error) => {
      reject(
        new Error(`${command} is required to generate icons: ${error.message}`),
      );
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} exited with ${code}`));
    });
  });
}
