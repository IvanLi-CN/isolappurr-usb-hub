import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";

import { DemoModeProvider, initDemoMode } from "../../app/demo-mode";
import { ThemeProvider } from "../../app/theme-ui";
import { DemoControlPanel } from "./DemoControlPanel";

function DemoControlPanelStorySurface() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDemoMode("/", "?demo=true");
    setReady(true);
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-start justify-end bg-[var(--bg)] p-4 sm:p-8">
      <DemoControlPanel />
    </div>
  );
}

const meta: Meta<typeof DemoControlPanel> = {
  title: "Layouts/DemoControlPanel",
  component: DemoControlPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story, context) => (
      <MemoryRouter initialEntries={["/?demo=true"]}>
        <DemoModeProvider>
          <ThemeProvider>
            <div
              className="min-h-screen"
              data-theme={context.parameters.isolapurrTheme ?? "isolapurr"}
            >
              <Story />
            </div>
          </ThemeProvider>
        </DemoModeProvider>
      </MemoryRouter>
    ),
  ],
  render: () => <DemoControlPanelStorySurface />,
};

export default meta;

type Story = StoryObj<typeof DemoControlPanel>;

async function openPanel(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: /demo/i }));
  const page = within(canvasElement.ownerDocument.body);
  await expect(
    await page.findByRole("dialog", { name: "Demo control panel" }),
  ).toBeInTheDocument();
}

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    await openPanel(canvasElement);
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ canvasElement }) => {
    await openPanel(canvasElement);
  },
};

export const DarkDesktop: Story = {
  parameters: {
    isolapurrTheme: "isolapurr-dark",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
};
