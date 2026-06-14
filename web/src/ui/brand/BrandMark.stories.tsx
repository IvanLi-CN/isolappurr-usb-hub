import type { Meta, StoryObj } from "@storybook/react";

import { BrandMark } from "./BrandMark";

const meta: Meta<typeof BrandMark> = {
  title: "Brand/BrandMark",
  component: BrandMark,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof BrandMark>;

export const Color: Story = {
  args: {
    className: "h-24 w-24",
    variant: "color",
  },
};

export const Monochrome: Story = {
  args: {
    className: "h-24 w-24",
    variant: "mono",
  },
};

export const ThemeGallery: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-5 rounded-[18px] bg-[var(--bg)] p-6 text-[var(--text)]">
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="h-20 w-20" variant="light" />
        <div className="text-[12px] font-bold">Light</div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="h-20 w-20" variant="dark" />
        <div className="text-[12px] font-bold">Dark</div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="h-12 w-12" variant="color" />
        <div className="text-[12px] font-bold">Toolbar</div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="h-8 w-8" variant="mono" />
        <div className="text-[12px] font-bold">Mono small</div>
      </div>
    </div>
  ),
};
