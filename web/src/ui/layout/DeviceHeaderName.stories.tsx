import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { ToastProvider } from "../toast/ToastProvider";
import { DeviceHeaderName } from "./DeviceHeaderName";

const meta: Meta<typeof DeviceHeaderName> = {
  title: "Layouts/DeviceHeaderName",
  component: DeviceHeaderName,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div
          className="min-w-[320px] bg-[var(--panel-2)] p-6 text-[var(--text)]"
          data-theme="isolapurr"
        >
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
  args: {
    title: "Studio 猫",
    editable: true,
    onSave: async (value) => ({ ok: true, value: { display_name: value } }),
  },
};

export default meta;

type Story = StoryObj<typeof DeviceHeaderName>;

export const Resting: Story = {};

export const InlineEditAndSave: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit device name" }),
    );
    const input = canvas.getByRole("textbox", { name: "Device name" });
    await expect(
      canvas.getByRole("button", { name: "Save device name" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Cancel editing device name" }),
    ).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "Bench Hub");
    await userEvent.keyboard("{Enter}");
    await expect(
      canvas.getByTestId("app-header-device-title"),
    ).toHaveTextContent("Bench Hub");
  },
};

export const InlineEditCancel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit device name" }),
    );
    const input = canvas.getByRole("textbox", { name: "Device name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Temporary name");
    await userEvent.click(
      canvas.getByRole("button", { name: "Cancel editing device name" }),
    );
    await expect(
      canvas.getByTestId("app-header-device-title"),
    ).toHaveTextContent("Studio 猫");
  },
};

export const InvalidName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit device name" }),
    );
    const input = canvas.getByRole("textbox", { name: "Device name" });
    await userEvent.clear(input);
    await userEvent.type(input, "   ");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "1-48 UTF-8 bytes",
    );
  },
};

export const CopyAction: Story = {
  args: { copyText: async () => undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Copy device name" }),
    );
    await expect(
      canvas.getByRole("button", { name: "Device name copied" }),
    ).toBeVisible();
  },
};

export const Unsupported: Story = {
  args: { editable: false, onSave: undefined },
};
