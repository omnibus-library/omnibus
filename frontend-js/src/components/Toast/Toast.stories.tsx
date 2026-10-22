import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { ToastProvider, useToast } from "./Toast";

function Opener({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast("Saved 2 changes")}>
        Show a toast
      </button>
      <button type="button" onClick={() => toast("Removed the tag")}>
        Show another
      </button>
      <button
        type="button"
        onClick={() =>
          toast("Books merged", { label: "Undo", onClick: onUndo })
        }
      >
        Show with Undo
      </button>
    </>
  );
}

const meta = {
  title: "Components/Toast",
  component: Opener,
  args: { onUndo: fn() },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof Opener>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsAMessageAsStatus: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show a toast" }));

    const status = await canvas.findByRole("status");
    await expect(status).toHaveTextContent("Saved 2 changes");
    await expect(status).toHaveAttribute("aria-live", "polite");
    // It fades in.
    await waitFor(() => expect(status).toBeVisible());
  },
};

export const HidesItselfAfterItsTimeout: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show a toast" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Saved 2 changes",
    );

    await waitFor(
      () =>
        expect(canvas.queryByText("Saved 2 changes")).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
  },
};

export const AnActionToastStaysUntilDismissed: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Show with Undo" }),
    );
    const message = await canvas.findByText("Books merged");
    await waitFor(() => expect(message).toBeVisible());

    // Past the plain toast's timeout, with the fade-out too.
    await new Promise((resolve) => setTimeout(resolve, 3200));
    await expect(message).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(args.onUndo).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(canvas.queryByText("Books merged")).not.toBeInTheDocument(),
    );
  },
};

export const DismissingAnActionToastDoesNotRunTheAction: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Show with Undo" }),
    );

    await userEvent.click(
      await canvas.findByRole("button", { name: "Dismiss" }),
    );

    await waitFor(() =>
      expect(canvas.queryByText("Books merged")).not.toBeInTheDocument(),
    );
    await expect(args.onUndo).not.toHaveBeenCalled();
  },
};

export const ANewToastReplacesTheOld: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Show with Undo" }),
    );
    await canvas.findByText("Books merged");

    await userEvent.click(canvas.getByRole("button", { name: "Show another" }));

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Removed the tag",
    );
    await expect(canvas.queryByText("Books merged")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  },
};
