import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";

import {
  RecoveryStrongConfirmationDialog,
  type RecoveryStrongConfirmationDialogProps,
} from "./RecoveryStrongConfirmationDialog";

type StoryArgs = RecoveryStrongConfirmationDialogProps & {
  initialValue?: string;
};

function ControlledDialog({ initialValue = "", ...args }: StoryArgs) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="min-h-screen bg-[var(--bg)] p-6">
      <RecoveryStrongConfirmationDialog
        {...args}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

const meta: Meta<StoryArgs> = {
  title: "Dialogs/RecoveryStrongConfirmationDialog",
  component: RecoveryStrongConfirmationDialog,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    onCancel: fn(),
    onConfirm: fn(),
    onChange: fn(),
    open: true,
    value: "",
  },
  render: (args) => <ControlledDialog {...args} />,
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Resting: Story = {};

export const Matched: Story = {
  args: {
    initialValue: "FLASH",
  },
};

export const Mobile393: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile393",
    },
  },
};

export const TypedConfirmation: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const input = page.getByRole("textbox", { name: "Confirmation code" });
    const confirm = page.getByRole("button", {
      name: "Confirm recovery flash",
    });

    await waitFor(() => expect(input).toHaveFocus());
    await expect(confirm).toBeDisabled();
    await userEvent.type(input, "FLASH");
    await expect(input).toHaveAttribute("data-confirmed", "true");
    await expect(confirm).toBeEnabled();
    await userEvent.keyboard("{Enter}");
    await expect(args.onConfirm).not.toHaveBeenCalled();
    await userEvent.click(confirm);
    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};
