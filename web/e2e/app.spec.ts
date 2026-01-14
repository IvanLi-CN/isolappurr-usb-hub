import { expect, test } from "@playwright/test";

test("renders devices list and mock dashboard", async ({ page }) => {
  const storageKey = "isolapurr_usb_hub.devices";
  const device = {
    id: "demo",
    name: "Demo Hub",
    baseUrl: "http://192.168.1.23",
  };

  await page.addInitScript(
    ({ storageKey, device }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([device]));
    },
    { storageKey, device },
  );

  await page.goto("/");

  await expect(page.getByTestId("device-list")).toBeVisible();
  await expect(page.getByTestId("device-card-demo")).toBeVisible();

  await page.getByTestId("device-card-demo").click();
  await expect(page.getByTestId("device-dashboard")).toBeVisible();

  await expect(page.getByTestId("port-card-port_a")).toBeVisible();
  await expect(page.getByTestId("port-card-port_c")).toBeVisible();
});

test("opens add device modal with discovery + manual columns (web)", async ({
  page,
}) => {
  const storageKey = "isolapurr_usb_hub.devices";
  await page.addInitScript(
    ({ storageKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([]));
    },
    { storageKey },
  );

  await page.goto("/");

  await page
    .getByTestId("device-list")
    .getByRole("button", { name: "+ Add" })
    .click();

  const dialog = page.getByTestId("add-device-dialog");
  await expect(dialog).toBeVisible();

  await expect(
    dialog.getByText("Auto discovery", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Manual add", { exact: true })).toBeVisible();

  await expect(
    dialog.getByText("Service discovery: Desktop App only", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("IP scan (advanced)", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create" })).toBeEnabled();
});
