import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { MemoryRouter } from "react-router";

import { NotFoundPage } from "../../pages/NotFoundPage";

const meta = {
  title: "Pages/NotFoundPage",
  component: NotFoundPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/missing-route"]}>
        <div className="min-h-screen" data-theme="isolapurr">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof NotFoundPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("error-state-full-page")).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Missing path: /missing-route"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Back to Dashboard" }),
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
