import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { type Shelf, toUser, type UserId } from "../../api";
import { WIRE_ADA } from "../../testing/wire";
import { ShelfPicker } from "./ShelfPicker";

const ADA = toUser(WIRE_ADA);

function aShelf(overrides: Partial<Shelf> = {}): Shelf {
  return {
    id: 7,
    kind: "manual",
    name: "Space operas",
    visibility: "private",
    accent: null,
    bookCount: 2,
    covers: [],
    owner: { id: ADA.id, name: "ada", hasAvatar: false },
    ...overrides,
  };
}

const targets = [aShelf(), aShelf({ id: 8, name: "To reread", bookCount: 0 })];

const meta = {
  title: "Components/ShelfPicker",
  component: ShelfPicker,
  args: {
    heading: "Add to shelf",
    viewer: ADA,
    busy: null,
    error: null,
    onPick: fn(),
    onClose: fn(),
    list: { status: "ready", targets, checked: [7], automatic: [] },
  },
  parameters: { path: "/books/x" },
} satisfies Meta<typeof ShelfPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TicksTheShelvesHoldingTheBook: Story = {
  play: async ({ canvas }) => {
    const dialog = canvas.getByRole("dialog", { name: "Add to shelf" });
    await expect(dialog).toBeInTheDocument();
    await expect(
      canvas.getByRole("checkbox", { name: "Space operas" }),
    ).toBeChecked();
    await expect(
      canvas.getByRole("checkbox", { name: "To reread" }),
    ).not.toBeChecked();
    await expect(canvas.getByTestId("shelf-picker-hint")).toHaveTextContent(
      "Only shelves you fill by hand are listed",
    );
  },
};

export const ClickingATileReportsItsShelf: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("checkbox", { name: "To reread" }));
    await expect(args.onPick).toHaveBeenCalledWith(8);
  },
};

export const NamesAStrangersShelfByItsOwner: Story = {
  args: {
    list: {
      status: "ready",
      targets: [
        aShelf({ owner: { id: 9 as UserId, name: "grace", hasAvatar: false } }),
      ],
      checked: [],
      automatic: [],
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("checkbox", { name: "Space operas by grace" }),
    ).toBeInTheDocument();
  },
};

export const SmartShelvesAreListedReadOnly: Story = {
  args: {
    list: {
      status: "ready",
      targets,
      checked: [],
      automatic: [aShelf({ id: 3, kind: "smart", name: "Unread sci-fi" })],
    },
  },
  play: async ({ canvas }) => {
    const section = canvas.getByTestId("shelf-picker-automatic");
    await expect(section).toHaveTextContent(
      "Automatic · follows each shelf's rules",
    );
    await expect(section).toHaveTextContent("Unread sci-fi");
    await expect(
      canvas.queryByRole("checkbox", { name: "Unread sci-fi" }),
    ).not.toBeInTheDocument();
  },
};

export const NoHandPickedShelves: Story = {
  args: { list: { status: "ready", targets: [], checked: [], automatic: [] } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByTestId("shelf-picker-empty")).toHaveTextContent(
      "You have no hand-picked shelves yet.",
    );
    await userEvent.click(canvas.getByRole("link", { name: "library page →" }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const Loading: Story = {
  args: { list: { status: "loading" } },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Gathering your shelves"),
    ).toBeInTheDocument();
  },
};

export const Failed: Story = {
  args: { list: { status: "failed" } },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByTestId("shelf-picker-unavailable"),
    ).toHaveTextContent("Your shelves didn’t load.");
  },
};

export const WriteInFlightMakesEveryTileInert: Story = {
  args: { busy: 7 },
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      canvas.getByRole("checkbox", { name: "Space operas" }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(
      canvas.getByRole("checkbox", { name: "To reread" }),
    ).toBeDisabled();
    await expect(canvas.getByTestId("shelf-picker-close")).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

export const FailureIsShownAndTilesKeepTheirState: Story = {
  args: { error: "Couldn’t update To reread: failed with 500" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Couldn’t update To reread: failed with 500",
    );
    await expect(
      canvas.getByRole("checkbox", { name: "To reread" }),
    ).not.toBeChecked();
  },
};

export const EscapeAndCloseDismiss: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("shelf-picker-close"));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalledTimes(2);
  },
};
