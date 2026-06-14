import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { toast } from "sonner";

function PwaUpdateToastDemo() {
  return (
    <div className="flex min-h-[220px] flex-col justify-between rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-6 text-[var(--text)]">
      <div>
        <div className="text-[18px] font-bold">PWA update prompt</div>
        <div className="mt-2 max-w-[48ch] text-[13px] font-semibold text-[var(--muted)]">
          The installed console prompts for a new service worker and dismisses
          the toast before applying the update.
        </div>
      </div>
      <button
        className="h-10 w-fit rounded-[10px] bg-[var(--primary)] px-4 text-[12px] font-bold text-[var(--primary-text)]"
        type="button"
        onClick={() => {
          const id = toast("A new IsolaPurr console is ready.", {
            description: "Apply the update to reload the offline app shell.",
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Update",
              onClick: () => toast.dismiss(id),
            },
            cancel: {
              label: "Later",
              onClick: () => toast.dismiss(id),
            },
          });
        }}
      >
        Show update prompt
      </button>
    </div>
  );
}

const meta: Meta<typeof PwaUpdateToastDemo> = {
  title: "PWA/UpdateToast",
  component: PwaUpdateToastDemo,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof PwaUpdateToastDemo>;

export const Prompt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Show update prompt" }),
    );
  },
};
