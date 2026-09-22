import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { type ReactNode, useLayoutEffect, useState } from "react";

import { ToastProvider } from "../toast/ToastProvider";
import { DevicePowerPanel } from "./DevicePowerPanel";
import {
  controlledHereConfig,
  defaultArgs,
  ok,
} from "./DevicePowerPanelStoryFixtures";

const meta: Meta<typeof DevicePowerPanel> = {
  title: "Panels/DevicePowerPanel",
  component: DevicePowerPanel,
  tags: ["autodocs", "two-stage-hold"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, context) =>
      context.parameters.skipToastProvider ? (
        <div className="min-h-screen bg-[var(--bg)]">
          <Story />
        </div>
      ) : (
        <ToastProvider>
          <div className="min-h-screen bg-[var(--bg)] p-6">
            <div className="mx-auto max-w-[1280px]">
              <Story />
            </div>
          </div>
        </ToastProvider>
      ),
  ],
};

export default meta;
type Story = StoryObj<typeof DevicePowerPanel>;

function StorybookTheme({
  children,
  theme,
}: {
  children: ReactNode;
  theme: "isolapurr" | "isolapurr-dark";
}) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (previousTheme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previousTheme);
    };
  }, [theme]);
  return <>{children}</>;
}

const retryInitialConfig = {
  ...controlledHereConfig,
  capability: {
    ...controlledHereConfig.capability,
    pd: {
      ...controlledHereConfig.capability.pd,
      fixed_voltages_mv: [9000, 12000],
    },
  },
};

function CrossTabRetryHarness({
  args,
  retryFails,
  takeoverFails = false,
  takeoverFailures = 1,
  takeoverRole = "leader",
}: {
  args: Story["args"];
  retryFails: boolean;
  takeoverFails?: boolean;
  takeoverFailures?: number;
  takeoverRole?: "leader" | "follower";
}) {
  const [savedConfig, setSavedConfig] = useState(retryInitialConfig);
  const [attempts, setAttempts] = useState(0);
  const [events, setEvents] = useState<string[]>([]);
  const [canonicalFixedVoltages, setCanonicalFixedVoltages] = useState(
    retryInitialConfig.capability.pd.fixed_voltages_mv,
  );
  const [lastSubmittedOutputMode, setLastSubmittedOutputMode] = useState({
    tps_mode: retryInitialConfig.tps_mode,
    voltage_mv: retryInitialConfig.manual.voltage_mv,
  });
  return (
    <div
      className="min-h-screen bg-[var(--bg)] p-12"
      data-visual-evidence-surface
    >
      <div className="mx-auto max-w-[1280px]" data-visual-evidence-target>
        <ToastProvider>
          <DevicePowerPanel
            {...args}
            requestRuntimeTakeover={async () => {
              setEvents((current) => [...current, "takeover"]);
              if (takeoverFails)
                throw new Error("Browser runtime lease is unavailable.");
              const lease = await args.requestRuntimeTakeover();
              return takeoverRole === "follower"
                ? { ...lease, role: "follower" as const, leaderTabId: "tab-b" }
                : lease;
            }}
            sharedPowerConfig={savedConfig}
            loadPowerConfig={() => ok(savedConfig)}
            savePowerConfig={async (input) => {
              const attempt = attempts;
              const fixedVoltages = input.capability.pd.fixed_voltages_mv;
              setLastSubmittedOutputMode({
                tps_mode: input.tps_mode,
                voltage_mv: input.manual.voltage_mv,
              });
              setAttempts((current) => current + 1);
              setEvents((current) => [
                ...current,
                `save:${JSON.stringify(fixedVoltages)}`,
              ]);
              if (attempt < takeoverFailures) {
                return {
                  ok: false,
                  error: {
                    kind: "busy" as const,
                    message:
                      "The active browser tab did not confirm this change.",
                    retryable: true as const,
                    recovery: "takeover" as const,
                  },
                };
              }
              if (retryFails) {
                return {
                  ok: false,
                  error: {
                    kind: "busy" as const,
                    message: "The device is still busy.",
                    retryable: true as const,
                  },
                };
              }
              const nextConfig = {
                ...savedConfig,
                tps_mode: input.tps_mode,
                manual: input.manual,
                capability: input.capability,
              };
              setSavedConfig(nextConfig);
              setCanonicalFixedVoltages(
                nextConfig.capability.pd.fixed_voltages_mv,
              );
              return ok(nextConfig);
            }}
          />
          <span className="sr-only" data-testid="save-attempts">
            {attempts}
          </span>
          <span className="sr-only" data-testid="retry-events">
            {JSON.stringify(events)}
          </span>
          <span className="sr-only" data-testid="canonical-fixed-voltages">
            {JSON.stringify(canonicalFixedVoltages)}
          </span>
          <span className="sr-only" data-testid="last-submitted-output-mode">
            {JSON.stringify(lastSubmittedOutputMode)}
          </span>
        </ToastProvider>
      </div>
    </div>
  );
}

const retryArgs = {
  ...defaultArgs,
  sharedPowerConfig: retryInitialConfig,
  loadPowerConfig: () => ok(retryInitialConfig),
};
const retryParameters = { skipToastProvider: true };

export const CrossTabSaveRetry: Story = {
  render: (args) => <CrossTabRetryHarness args={args} retryFails={false} />,
  tags: ["retry-recovery"],
  args: retryArgs,
  parameters: retryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    await waitFor(() => expect(retryButton).toBeVisible());
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 9V" }),
    );
    const voltageInput = await canvas.findByDisplayValue("9 V");
    await userEvent.clear(voltageInput);
    await userEvent.type(voltageInput, "12 V");
    await userEvent.click(retryButton);
    await waitFor(() =>
      expect(canvas.getByTestId("save-attempts")).toHaveTextContent("2"),
    );
    await expect(canvas.getByTestId("retry-events")).toHaveTextContent(
      '["save:[9000]","takeover","save:[]"]',
    );
    await expect(
      canvas.getByTestId("canonical-fixed-voltages"),
    ).toHaveTextContent("[]");
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(0),
    );
    for (const voltage of ["9V", "12V", "15V", "20V"]) {
      await expect(
        canvas.getByRole("button", { name: `Fixed PDO ${voltage}` }),
      ).toHaveAttribute("aria-pressed", "false");
    }
  },
};

export const CrossTabManualSaveClearsRetry: Story = {
  render: (args) => <CrossTabRetryHarness args={args} retryFails={false} />,
  args: retryArgs,
  parameters: retryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    await page.findByRole("button", { name: "Retry" });
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 15V" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Save and apply" }),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("save-attempts")).toHaveTextContent("2"),
    );
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(0),
    );
    await expect(
      canvas.getByRole("button", { name: "Fixed PDO 15V" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const CrossTabOutputModeSaveRetry: Story = {
  render: (args) => <CrossTabRetryHarness args={args} retryFails={false} />,
  args: retryArgs,
  tags: ["retry-recovery"],
  parameters: retryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const voltageInput = await canvas.findByDisplayValue("9 V");
    await userEvent.clear(voltageInput);
    await userEvent.type(voltageInput, "12 V");
    await userEvent.click(
      await canvas.findByRole("button", { name: "Save and apply" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    await userEvent.clear(await canvas.findByDisplayValue("12 V"));
    await userEvent.type(await canvas.findByDisplayValue(""), "15 V");
    await userEvent.click(retryButton);
    await waitFor(() =>
      expect(canvas.getByTestId("save-attempts")).toHaveTextContent("2"),
    );
    await expect(
      canvas.getByTestId("last-submitted-output-mode"),
    ).toHaveTextContent('{"tps_mode":"manual","voltage_mv":15000}');
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(0),
    );
  },
};

export const CrossTabRetryFailure: Story = {
  render: (args) => <CrossTabRetryHarness args={args} retryFails />,
  args: retryArgs,
  parameters: retryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    await userEvent.click(retryButton);
    await waitFor(() =>
      expect(canvas.getByTestId("save-attempts")).toHaveTextContent("2"),
    );
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(0),
    );
    await expect(
      canvas.getByRole("button", { name: "Fixed PDO 12V" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

export const CrossTabRetryScreenshot: Story = {
  render: (args) => <CrossTabRetryHarness args={args} retryFails />,
  args: retryArgs,
  parameters: {
    ...retryParameters,
    viewport: { defaultViewport: "isolapurrLaptop" },
  },
  decorators: [
    (Story) => (
      <StorybookTheme theme="isolapurr">
        <Story />
      </StorybookTheme>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    await waitFor(() => expect(retryButton).toBeVisible());
    await expect(retryButton.closest("[data-sonner-toaster]")).toHaveAttribute(
      "data-sonner-theme",
      "light",
    );
  },
};

export const CrossTabRetryScreenshotDark: Story = {
  ...CrossTabRetryScreenshot,
  tags: ["retry-recovery"],
  decorators: [
    (Story) => (
      <StorybookTheme theme="isolapurr-dark">
        <Story />
      </StorybookTheme>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    const toast = retryButton.closest<HTMLElement>("[data-sonner-toast]");
    const toaster = toast?.closest<HTMLElement>("[data-sonner-toaster]");
    const closeButton = toast?.querySelector<HTMLElement>(
      "[data-close-button]",
    );
    const retryAction = toast?.querySelector<HTMLElement>(
      "[data-button][data-action]",
    );
    if (!toast || !toaster || !closeButton || !retryAction)
      throw new Error("Expected the retry warning toast and its controls.");
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--surface-warning-bg)";
    document.body.append(probe);
    const expectedBackground = getComputedStyle(probe).backgroundColor;
    probe.style.backgroundColor = "var(--action-warning-bg)";
    const expectedActionBackground = getComputedStyle(probe).backgroundColor;
    probe.style.color = "var(--action-warning-text)";
    const expectedActionText = getComputedStyle(probe).color;
    probe.remove();
    await waitFor(() =>
      expect(toaster).toHaveAttribute("data-sonner-theme", "dark"),
    );
    await expect(toast).toHaveStyle({
      backgroundColor: expectedBackground,
      color: "rgb(233, 238, 244)",
    });
    await expect(closeButton).toHaveStyle({
      backgroundColor: expectedBackground,
    });
    await expect(retryAction).toHaveStyle({
      backgroundColor: expectedActionBackground,
      color: expectedActionText,
    });
  },
};

export const CrossTabTakeoverFailure: Story = {
  render: (args) => (
    <CrossTabRetryHarness args={args} retryFails={false} takeoverFails />
  ),
  args: retryArgs,
  parameters: retryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    await userEvent.click(retryButton);
    await waitFor(() =>
      expect(canvas.getByTestId("retry-events")).toHaveTextContent(
        '["save:[9000]","takeover"]',
      ),
    );
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(1),
    );
    await expect(canvas.getByTestId("save-attempts")).toHaveTextContent("1");
  },
};

export const CrossTabTakeoverFollower: Story = {
  render: (args) => (
    <CrossTabRetryHarness
      args={args}
      retryFails={false}
      takeoverRole="follower"
    />
  ),
  args: retryArgs,
  parameters: retryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 12V" }),
    );
    const retryButton = await page.findByRole("button", { name: "Retry" });
    await userEvent.click(retryButton);
    await waitFor(() =>
      expect(canvas.getByTestId("retry-events")).toHaveTextContent(
        '["save:[9000]","takeover"]',
      ),
    );
    await expect(canvas.getByTestId("save-attempts")).toHaveTextContent("1");
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(1),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fixed PDO 15V" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Save and apply" }),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("save-attempts")).toHaveTextContent("2"),
    );
    await waitFor(() =>
      expect(page.queryAllByRole("button", { name: "Retry" })).toHaveLength(0),
    );
  },
};
