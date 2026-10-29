import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { expect, waitFor } from "storybook/test";
import { unloadPrevented } from "../../testing/unloadGuard";
import { UnsavedDialog, useLeaveGuard, useUnloadGuard } from "./Unsaved";

function Form() {
  const [dirty, setDirty] = useState(false);
  const { blocker } = useLeaveGuard(dirty);
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={dirty}
          onChange={(e) => setDirty(e.target.checked)}
        />
        Edited
      </label>
      <Link to="/elsewhere">Leave</Link>
      <UnsavedDialog
        blocker={blocker}
        body="You've edited this book's details without saving them."
      />
    </>
  );
}

// The guard needs a data router, which the stories' own harness doesn't provide.
function Guarded() {
  const [router] = useState(() =>
    createMemoryRouter([
      { path: "/", element: <Form /> },
      { path: "/elsewhere", element: <p>Elsewhere</p> },
    ]),
  );
  return <RouterProvider router={router} />;
}

const meta = {
  title: "Components/Unsaved",
  component: Guarded,
  parameters: { ownRouter: true },
} satisfies Meta<typeof Guarded>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AsksBeforeLeaving: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await expect(unloadPrevented()).toBe(true);
    await userEvent.click(canvas.getByRole("link", { name: "Leave" }));

    const dialog = await canvas.findByRole("dialog", {
      name: "Discard unsaved changes",
    });
    await expect(dialog).toHaveTextContent("Discard unsaved changes?");
    await expect(dialog).toHaveTextContent(
      "You've edited this book's details without saving them.",
    );
    await expect(
      canvas.getByRole("button", { name: "Keep editing" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Elsewhere")).not.toBeInTheDocument();
  },
};

export const KeepEditing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByRole("link", { name: "Leave" }));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Keep editing" }),
    );

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByLabelText("Edited")).toBeChecked();
  },
};

export const EscapeKeepsEditing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByRole("link", { name: "Leave" }));
    await canvas.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(canvas.queryByText("Elsewhere")).not.toBeInTheDocument();
  },
};

export const BackdropKeepsEditing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByRole("link", { name: "Leave" }));
    await userEvent.click(await canvas.findByRole("dialog"));

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

export const Discards: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByRole("link", { name: "Leave" }));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Discard" }),
    );

    await expect(await canvas.findByText("Elsewhere")).toBeInTheDocument();
    await waitFor(() => expect(unloadPrevented()).toBe(false));
  },
};

export const LeavesCleanWithoutAsking: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("link", { name: "Leave" }));

    await expect(await canvas.findByText("Elsewhere")).toBeInTheDocument();
    await expect(unloadPrevented()).toBe(false);
  },
};

export const KeepsFocusInside: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    const leave = canvas.getByRole("link", { name: "Leave" });
    await userEvent.click(leave);
    const dialog = await canvas.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());

    // Keep editing, Discard, then back around to Keep editing.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Keep editing" }),
    ).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(leave).toHaveFocus());
  },
};

function Guard({ label }: { label: string }) {
  const [dirty, setDirty] = useState(false);
  useUnloadGuard(dirty);
  return (
    <label>
      <input
        type="checkbox"
        checked={dirty}
        onChange={(e) => setDirty(e.target.checked)}
      />
      {label}
    </label>
  );
}

export const GuardsStayIndependent: Story = {
  render: () => (
    <>
      <Guard label="First" />
      <Guard label="Second" />
    </>
  ),
  play: async ({ canvas, userEvent }) => {
    const first = await canvas.findByLabelText("First");
    const second = canvas.getByLabelText("Second");
    await userEvent.click(first);
    await userEvent.click(second);
    await expect(unloadPrevented()).toBe(true);

    // One guard going quiet leaves the other's protection in place.
    await userEvent.click(first);
    await expect(unloadPrevented()).toBe(true);

    await userEvent.click(second);
    await expect(unloadPrevented()).toBe(false);
  },
};
