import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";

import { PwaStartupShell } from "./PwaStartupShell";

const meta = {
  title: "PWA/StartupShell",
  component: PwaStartupShell,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  decorators: [
    (Story, context) => (
      <div
        className="min-h-screen"
        data-theme={context.parameters.isolapurrTheme ?? "isolapurr"}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onRepair: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof PwaStartupShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Launching: Story = {
  args: {
    state: "launching",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("pwa-startup-shell-status"),
    ).toHaveTextContent("Starting console…");
    await expect(
      canvas.queryByTestId("pwa-startup-shell-repair"),
    ).not.toBeInTheDocument();
  },
};

export const LaunchingDesktop: Story = {
  ...Launching,
  parameters: {
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
};

export const Recovering: Story = {
  args: {
    state: "recovering",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("pwa-startup-shell-status"),
    ).toHaveTextContent("Repairing console…");
  },
};

export const Failed: Story = {
  args: {
    state: "failed",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("pwa-startup-shell-retry"));
    await userEvent.click(canvas.getByTestId("pwa-startup-shell-repair"));
    await expect(args.onRetry).toHaveBeenCalled();
    await expect(args.onRepair).toHaveBeenCalled();
  },
};

export const FailedDark: Story = {
  ...Failed,
  parameters: {
    isolapurrTheme: "isolapurr-dark",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
};
