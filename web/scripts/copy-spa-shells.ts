import { copyFile, mkdir } from "node:fs/promises";

const distPath = new URL("../dist/", import.meta.url);
const indexPath = new URL("index.html", distPath);
const shellCopies = [
  new URL("404.html", distPath),
  new URL("flash/index.html", distPath),
];

try {
  for (const targetPath of shellCopies) {
    await mkdir(new URL(".", targetPath), { recursive: true });
    await copyFile(indexPath, targetPath);
  }
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    process.stderr.write(
      "Missing dist/index.html. Run `bun run build` first.\n",
    );
    process.exit(1);
  }
  throw error;
}
