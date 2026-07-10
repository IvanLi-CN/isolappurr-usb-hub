import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { DEMO_BUNDLED_FIRMWARE_MANIFEST } from "../../domain/firmwareBundle";
import { FirmwareReleaseList } from "./FirmwareReleaseList";

const meta: Meta<typeof FirmwareReleaseList> = {
  title: "Panels/FirmwareReleaseList",
  component: FirmwareReleaseList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  render: (args) => {
    const [selectedTag, setSelectedTag] = useState(args.selectedTag);
    return (
      <div className="max-w-[860px]">
        <FirmwareReleaseList
          {...args}
          selectedTag={selectedTag}
          onSelect={setSelectedTag}
        />
      </div>
    );
  },
  args: {
    releases: DEMO_BUNDLED_FIRMWARE_MANIFEST.releases,
    selectedTag: "v0.5.1",
    recoveryOnly: false,
    onSelect: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof FirmwareReleaseList>;

export const Default: Story = {};

export const RecoveryOnly: Story = {
  args: {
    recoveryOnly: true,
  },
};

export const Empty: Story = {
  args: {
    releases: [],
    selectedTag: null,
  },
};
