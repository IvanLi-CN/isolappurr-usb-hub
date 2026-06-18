import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { MemoryRouter } from "react-router";

import { MissingDeviceState } from "./MissingDeviceState";

const meta = {
  title: "Errors/MissingDeviceState",
  component: MissingDeviceState,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div
          className="min-h-[420px] bg-[var(--bg)] p-6"
          data-theme="isolapurr"
        >
          <div className="mx-auto max-w-[920px]">
            <Story />
          </div>
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof MissingDeviceState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("device-not-found")).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "Device entry not found" }),
    ).toBeVisible();
    await expect(
      canvas.getByText(
        "This saved device is no longer available in local storage. Return to a known screen to pick another hub or add it again.",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Dashboard" }),
    ).toHaveAttribute("href", "/");
    await expect(canvas.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: Desktop.play,
};
