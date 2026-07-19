import type { Meta, StoryObj } from "@storybook/react";

import { BrandLogo } from "./BrandLogo";

const meta: Meta<typeof BrandLogo> = {
  title: "Brand/BrandLogo",
  component: BrandLogo,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof BrandLogo>;

export const Default: Story = {
  args: {
    className: "text-[var(--text)]",
    markVariant: "color",
  },
};

export const ThemeGallery: Story = {
  render: () => (
    <div className="grid gap-5 rounded-[18px] bg-[var(--bg)] p-6 text-[var(--text)]">
      <div className="flex items-center justify-center rounded-[16px] border border-[var(--border)] bg-[var(--panel)] p-5">
        <BrandLogo className="text-[var(--text)]" markVariant="color" />
      </div>
      <div
        className="flex items-center justify-center rounded-[16px] border border-[var(--border)] bg-[#171d26] p-5 text-[#e9eef4]"
        data-theme="isolapurr-dark"
      >
        <BrandLogo className="text-current" markVariant="color" />
      </div>
    </div>
  ),
};
