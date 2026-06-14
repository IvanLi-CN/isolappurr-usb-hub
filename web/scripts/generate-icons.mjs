import { spawn } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/assets/brand/isolapurr-mark.svg");
const sourceMono = resolve(root, "src/assets/brand/isolapurr-mark-mono.svg");
const publicDir = resolve(root, "public");
const iconDir = resolve(publicDir, "icons");

const pngTargets = [
  ["favicon-16.png", 16, source],
  ["favicon-32.png", 32, source],
  ["favicon-48.png", 48, source],
  ["pwa-192.png", 192, source],
  ["pwa-512.png", 512, source],
  ["maskable-192.png", 192, source],
  ["maskable-512.png", 512, source],
  ["apple-touch-icon.png", 180, source],
  ["desktop-256.png", 256, source],
  ["desktop-512.png", 512, source],
];

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
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

await run("rsvg-convert", ["--version"]);
await run("python3", ["-c", "import PIL"]);

await mkdir(iconDir, { recursive: true });
await copyFile(source, resolve(iconDir, "isolapurr-mark.svg"));
await copyFile(sourceMono, resolve(iconDir, "isolapurr-mark-mono.svg"));

for (const [name, size, src] of pngTargets) {
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
