import type { Meta, StoryObj } from "@storybook/react";
import { waitFor } from "@storybook/test";
import { useEffect } from "react";
import { toast } from "sonner";

function showPwaUpdateToast() {
  let toastId: string | number | undefined;
  toastId = toast("A new IsolaPurr console is ready.", {
    description: "Apply the update to reload the offline app shell.",
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: "Update",
      onClick: () => {
        if (toastId !== undefined) {
          toast.dismiss(toastId);
        }
      },
    },
    cancel: {
      label: "Later",
      onClick: () => {
        if (toastId !== undefined) {
          toast.dismiss(toastId);
        }
      },
    },
  });
}

function PwaUpdateToastDemo() {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      showPwaUpdateToast();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      toast.dismiss();
    };
  }, []);

  return <div aria-hidden="true" className="min-h-screen w-full" />;
}

const meta: Meta<typeof PwaUpdateToastDemo> = {
  title: "PWA/UpdateToast",
  component: PwaUpdateToastDemo,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PwaUpdateToastDemo>;

export const Prompt: Story = {
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    await waitFor(() => {
      if (!doc.querySelector("[data-sonner-toast]")) {
        throw new Error("Toast not visible");
      }
    });
  },
};
