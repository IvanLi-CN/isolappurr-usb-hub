import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

import { ActionButton, ActionGroup, IconButton } from "./ActionButton";
import { ConfirmDialog } from "./ConfirmDialog";

function RefreshGlyph() {
  return <span className="text-[15px] leading-none">↻</span>;
}

function ActionGallery({ theme }: { theme?: "isolapurr" | "isolapurr-dark" }) {
  return (
    <section
      className="grid gap-5 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] p-5 text-[var(--text)]"
      data-theme={theme}
    >
      <div>
        <div className="text-[15px] font-bold">Action hierarchy</div>
        <div className="mt-1 text-[12px] font-semibold text-[var(--muted)]">
          Normal commands stay calm. Reset and clear actions are warning-level.
          Final deletion is error-level.
        </div>
      </div>
      <ActionGroup className="justify-start">
        <ActionButton tone="primary">Save Wi-Fi</ActionButton>
        <ActionButton tone="secondary">Cancel</ActionButton>
        <ActionButton tone="quiet">Show details</ActionButton>
        <ActionButton tone="warning">Clear settings</ActionButton>
        <ActionButton tone="danger">Delete device</ActionButton>
        <ActionButton emphasis="solid" tone="danger">
          Confirm deletion
        </ActionButton>
      </ActionGroup>
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton disabled tone="primary">
          Unavailable
        </ActionButton>
        <ActionButton loading tone="secondary">
          Applying
        </ActionButton>
        <IconButton label="Refresh device state" tone="secondary">
          <RefreshGlyph />
        </IconButton>
      </div>
    </section>
  );
}

function ConfirmationExample() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[var(--bg)] p-5">
      <ActionButton tone="danger" onClick={() => setOpen(true)}>
        Delete saved device
      </ActionButton>
      <ConfirmDialog
        confirmLabel="Delete device"
        description="The device is removed from this browser only. Hardware settings stay unchanged."
        open={open}
        title="Delete this saved device?"
        tone="danger"
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      />
    </div>
  );
}

const meta: Meta<typeof ActionButton> = {
  title: "Actions/ActionButton",
  component: ActionButton,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof ActionButton>;

export const Light: Story = {
  render: () => <ActionGallery theme="isolapurr" />,
};

export const Dark: Story = {
  render: () => <ActionGallery theme="isolapurr-dark" />,
};

export const ConfirmDangerousAction: Story = {
  render: () => <ConfirmationExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete saved device" }),
    );
    await expect(
      await page.findByRole("alertdialog", {
        name: "Delete this saved device?",
      }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(
      page.queryByRole("alertdialog", { name: "Delete this saved device?" }),
    ).not.toBeInTheDocument();
  },
};
