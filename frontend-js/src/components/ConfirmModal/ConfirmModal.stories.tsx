import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { ConfirmDialog } from "./ConfirmModal";

const meta = {
  title: "Components/ConfirmModal",
  component: ConfirmDialog,
  args: {
    testId: "demo-confirm",
    title: "Delete this shelf?",
    body: "The books stay in your library. This can't be undone.",
    action: "Delete",
    busyLabel: "Deleting…",
    busy: false,
    onCancel: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const dialog = canvas.getByRole("dialog", { name: "Delete this shelf?" });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      canvas.getByRole("heading", { name: "Delete this shelf?" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(dialog).toHaveFocus());

    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));

    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};

export const DismissesOnEscapeAndBackdrop: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const dialog = canvas.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());

    await userEvent.keyboard("{Escape}");
    await userEvent.click(dialog);
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await expect(args.onCancel).toHaveBeenCalledTimes(3);
  },
};

export const ClickInsideThePanelKeepsItOpen: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByText("The books stay in your library. This can't be undone."),
    );

    await expect(args.onCancel).not.toHaveBeenCalled();
  },
};

export const KeepsTabInside: Story = {
  play: async ({ canvas, userEvent }) => {
    // The dialog takes focus a frame after it opens; move focus only after that.
    await waitFor(() => expect(canvas.getByRole("dialog")).toHaveFocus());
    const [cancel, confirm] = [
      canvas.getByRole("button", { name: "Cancel" }),
      canvas.getByRole("button", { name: "Delete" }),
    ];
    confirm.focus();

    await userEvent.tab();
    await expect(cancel).toHaveFocus();

    await userEvent.tab({ shift: true });
    await expect(confirm).toHaveFocus();
  },
};

export const WorkingIgnoresDismissal: Story = {
  args: { busy: true },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("dialog"));

    await expect(args.onCancel).not.toHaveBeenCalled();
    const confirm = canvas.getByRole("button", { name: "Deleting…" });
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    await expect(confirm).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeDisabled();
  },
};

export const ShowsANoteAboveTheButtons: Story = {
  args: { note: <p role="alert">Couldn't delete: failed with 500</p> },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Couldn't delete: failed with 500",
    );
  },
};
