import { expect, test } from "@playwright/test";

const DEVICE_ID = "856a141cdbd4";
const DEVICE_NAME = "656A14";
const DEVD_DEVICE_ID = "usb--dev-cu-usbmodem21221401";
const DEVD_BASE_URL =
  process.env.ISOLAPURR_HIL_DEVD_BASE_URL ?? "http://127.0.0.1:51233";
const LOCAL_USB_PORT_PATH = "/dev/cu.usbmodem21221401";
const HIL_ENABLED = process.env.ISOLAPURR_HIL === "1";

type PowerConfigResponse = {
  result: {
    light_load_mode: "pfm" | "fpwm";
    persisted: boolean;
    tps_mode: "auto_follow" | "manual";
    manual: {
      voltage_mv: number;
      current_limit_ma: number;
      usb_c_path_mode: "default" | "disconnect" | "force";
    };
    capability: {
      profile: string;
      power_watts: number;
      protocols: Record<string, boolean>;
      pd: {
        pps: boolean;
        fixed_voltages_mv: number[];
      };
    };
  };
};

async function getBridgeToken(): Promise<string> {
  const res = await fetch(`${DEVD_BASE_URL}/api/v1/bootstrap`);
  if (!res.ok) {
    throw new Error(`bootstrap failed (${res.status})`);
  }
  const json = (await res.json()) as { token?: string };
  if (!json.token) {
    throw new Error("bootstrap token missing");
  }
  return json.token;
}

async function bridgeRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getBridgeToken();
  return fetch(`${DEVD_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function seedDesktopStorage(): Promise<void> {
  const reset = await bridgeRequest("/api/v1/storage/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!reset.ok) {
    throw new Error(`storage reset failed (${reset.status})`);
  }

  const save = await bridgeRequest("/api/v1/storage/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device: {
        id: DEVICE_ID,
        name: DEVICE_NAME,
        baseUrl: `isolapurr-devd://${DEVD_DEVICE_ID}`,
        transports: {
          localUsbPortPath: LOCAL_USB_PORT_PATH,
        },
      },
    }),
  });
  if (!save.ok) {
    throw new Error(`storage save failed (${save.status})`);
  }
}

async function bridgePowerConfig(): Promise<PowerConfigResponse["result"]> {
  const res = await bridgeRequest(
    `/api/v1/devices/${DEVD_DEVICE_ID}/power/config`,
  );
  if (!res.ok) {
    throw new Error(`power config get failed (${res.status})`);
  }
  return ((await res.json()) as PowerConfigResponse).result;
}

async function bridgeSetLightLoadMode(
  mode: "pfm" | "fpwm",
): Promise<PowerConfigResponse["result"]> {
  const current = await bridgePowerConfig();
  const owner = 424242;
  const res = await bridgeRequest(
    `/api/v1/devices/${DEVD_DEVICE_ID}/power/config?owner=${owner}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hardware: "sw2303",
        tps_mode: current.tps_mode,
        light_load_mode: mode,
        capability: current.capability,
        manual: {
          voltage_mv: current.manual.voltage_mv,
          current_limit_ma: current.manual.current_limit_ma,
          usb_c_path_mode: current.manual.usb_c_path_mode,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`power config set failed (${res.status})`);
  }
  return ((await res.json()) as PowerConfigResponse).result;
}

test.skip(
  !HIL_ENABLED,
  "Set ISOLAPURR_HIL=1 and ISOLAPURR_HIL_DEVD_BASE_URL to run live hardware HIL.",
);

test("HIL: web power panel persists light-load mode", async ({ page }) => {
  await seedDesktopStorage();
  await bridgeSetLightLoadMode("pfm");
  await expect
    .poll(async () => (await bridgePowerConfig()).light_load_mode, {
      timeout: 30_000,
      intervals: [1000, 2000, 3000],
    })
    .toBe("pfm");

  await page.goto(`/devices/${DEVICE_ID}/power`);
  await expect(page.getByTestId("device-power-panel")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("USB-C / Power")).toBeVisible();

  await page.getByRole("button", { name: "FPWM" }).click();
  await page.getByRole("button", { name: "Save and apply" }).click();

  await expect(page.getByText(/Saved and applied|EEPROM saved/i)).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(
      async () => {
        try {
          return (await bridgePowerConfig()).light_load_mode;
        } catch {
          return "pending";
        }
      },
      {
        timeout: 45_000,
        intervals: [1000, 2000, 3000],
      },
    )
    .toBe("fpwm");

  await page.getByRole("button", { name: "PFM" }).click();
  await page.getByRole("button", { name: "Save and apply" }).click();

  await expect(page.getByText(/Saved and applied|EEPROM saved/i)).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(
      async () => {
        try {
          return (await bridgePowerConfig()).light_load_mode;
        } catch {
          return "pending";
        }
      },
      {
        timeout: 45_000,
        intervals: [1000, 2000, 3000],
      },
    )
    .toBe("pfm");
});
