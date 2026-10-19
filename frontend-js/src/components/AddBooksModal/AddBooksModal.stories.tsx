import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { addShelfBooksHandler, libraryHandler } from "../../testing/handlers";
import { aWireLibrary, uuidOf } from "../../testing/wire";
import { AddBooksModal } from "./AddBooksModal";

const added: { id: number; uuids: string[] }[] = [];

const meta = {
  title: "Components/AddBooksModal",
  component: AddBooksModal,
  args: {
    shelfId: 3,
    shelfName: "Winter reads",
    members: [uuidOf(1)],
    onClose: fn(),
    onAdded: fn(),
  },
  beforeEach({ msw }) {
    added.length = 0;
    msw.use(
      libraryHandler(aWireLibrary(6), 100),
      addShelfBooksHandler({ added }),
    );
  },
} satisfies Meta<typeof AddBooksModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingPicked: Story = {
  play: async ({ canvas }) => {
    const dialog = canvas.getByRole("dialog", {
      name: "Add books to Winter reads",
    });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(canvas.getByText("Adding to")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 2, name: "Winter reads" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Add books" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("searchbox", { name: "Search your library" }),
    ).toHaveFocus();
  },
};

export const AddSuccess: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByTestId(`picker-tile-${uuidOf(2)}`),
    );
    await expect(
      canvas.getByRole("button", { name: "Add 1 book" }),
    ).toBeEnabled();
    await userEvent.click(canvas.getByTestId(`picker-tile-${uuidOf(3)}`));

    await userEvent.click(canvas.getByRole("button", { name: "Add 2 books" }));

    await waitFor(() => expect(args.onAdded).toHaveBeenCalledOnce());
    await expect(added).toEqual([{ id: 3, uuids: [uuidOf(2), uuidOf(3)] }]);
  },
};

export const AddFailing: Story = {
  beforeEach({ msw }) {
    msw.use(addShelfBooksHandler({ refuse: "You can’t edit this shelf." }));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByTestId(`picker-tile-${uuidOf(2)}`),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Add 1 book" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t add these books: You can’t edit this shelf.",
    );
    await expect(
      canvas.getByTestId(`picker-tile-${uuidOf(2)}`),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getByRole("button", { name: "Add 1 book" }),
    ).toBeEnabled();
    await expect(args.onAdded).not.toHaveBeenCalled();
  },
};

export const MembersAreMarked: Story = {
  play: async ({ canvas }) => {
    const member = await canvas.findByTestId(`picker-tile-${uuidOf(1)}`);
    await expect(member).toHaveAttribute("aria-disabled", "true");
    await expect(member).toHaveTextContent("On this shelf");
  },
};

export const CloseWithEscape: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await canvas.findByTestId(`picker-tile-${uuidOf(2)}`);

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

export const CloseWithButtons: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await expect(args.onClose).toHaveBeenCalledTimes(2);
  },
};
