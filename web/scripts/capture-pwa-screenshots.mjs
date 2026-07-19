import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

function readFlag(name) {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === exact) {
      return process.argv[index + 1] ?? null;
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return null;
}

const baseUrl = readFlag("base-url");

if (!baseUrl) {
  throw new Error("Missing required --base-url argument.");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  colorScheme: "light",
  deviceScaleFactor: 1,
  viewport: { width: 1440, height: 900 },
});

const outputDir = resolve(process.cwd(), "public/pwa");
await mkdir(outputDir, { recursive: true });

await context.addInitScript(() => {
  window.localStorage.setItem(
    "isolapurr_usb_hub.devices",
    JSON.stringify([
      {
        id: "aabbcc001122",
        name: "Bench Hub",
        baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
      },
      {
        id: "ddee11223344",
        name: "Recovery Shelf",
        baseUrl: "http://192.168.31.88",
      },
    ]),
  );
  window.localStorage.setItem(
    "isolapurr_usb_hub.theme",
    JSON.stringify("isolapurr"),
  );
  window.localStorage.setItem("isolapurr.demo.enabled", "false");
});

const captures = [
  {
    path: resolve(outputDir, "dashboard-wide.png"),
    route: "/",
    waitFor: "[data-testid='dashboard']",
  },
  {
    path: resolve(outputDir, "flash-wide.png"),
    route: "/flash?demo=true",
    waitFor: "[data-testid='firmware-flash-page']",
  },
];

for (const capture of captures) {
  const page = await context.newPage();
  await page.goto(new URL(capture.route, baseUrl).toString(), {
    waitUntil: "networkidle",
  });
  await page.locator(capture.waitFor).waitFor();
  await page.screenshot({ path: capture.path, type: "png" });
  await page.close();
}

await context.close();
await browser.close();
