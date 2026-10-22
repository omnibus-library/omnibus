import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, waitFor } from "storybook/test";
import { Sheet } from "./Sheet";

function Harness({
  onDismiss,
  busy = false,
}: {
  onDismiss: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      {open && (
        <Sheet
          label="Edit Red Rising"
          onDismiss={onDismiss}
          closing={closing}
          onClosed={() => {
            setOpen(false);
            setClosing(false);
          }}
          busy={busy}
        >
          <h2>Edit Red Rising</h2>
          <input aria-label="Title" />
          <button type="button" onClick={() => setClosing(true)}>
            Close
          </button>
        </Sheet>
      )}
    </>
  );
}

const meta = {
  title: "Components/Sheet",
  component: Harness,
  args: { onDismiss: fn() },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensWithFocusInside: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open sheet" }));

    const sheet = await canvas.findByRole("dialog", {
      name: "Edit Red Rising",
    });
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    await expect(sheet.contains(document.activeElement)).toBe(true);
  },
};

export const EscapeAsksTheOwner: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open sheet" }));
    await canvas.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await expect(args.onDismiss).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const BackdropClickAsksTheOwner: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open sheet" }));

    await userEvent.click(await canvas.findByRole("dialog"));

    await expect(args.onDismiss).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const BusyIgnoresEscape: Story = {
  args: { busy: true },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open sheet" }));
    await canvas.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await expect(args.onDismiss).not.toHaveBeenCalled();
  },
};

export const ClosingPlaysThenCallsOnClosed: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open sheet" }));
    const sheet = await canvas.findByRole("dialog");

    await userEvent.click(canvas.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(sheet).toHaveClass("is-closing"));
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

export const FocusReturnsToTheOpener: Story = {
  play: async ({ canvas, userEvent }) => {
    const opener = canvas.getByRole("button", { name: "Open sheet" });
    await userEvent.click(opener);
    await canvas.findByRole("dialog");

    await userEvent.click(canvas.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(opener).toHaveFocus());
  },
};
