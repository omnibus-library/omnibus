import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { parseBookUuid, type Shelf, toUser, type UserId } from "../../api";
import { WIRE_ADA } from "../../testing/wire";
import { accentStyle, ShelfTileFace } from "./ShelfTile";

const ADA = toUser(WIRE_ADA);
function cover(n: number) {
  const uuid = parseBookUuid(`00000000-0000-4000-8000-00000000000${n}`);
  if (!uuid) throw new Error("fixture uuid");
  return uuid;
}

function aShelf(overrides: Partial<Shelf> = {}): Shelf {
  return {
    id: 7,
    kind: "manual",
    name: "Space operas",
    visibility: "private",
    accent: "oklch(0.6 0.15 250)",
    bookCount: 2,
    covers: [],
    owner: { id: ADA.id, name: "ada", hasAvatar: false },
    ...overrides,
  };
}

function Tile({ shelf, viewerId }: { shelf: Shelf; viewerId: UserId }) {
  return (
    <div className="shv-card shv-card--compact" style={accentStyle(shelf)}>
      <ShelfTileFace shelf={shelf} viewerId={viewerId} prefix="story" />
    </div>
  );
}

const meta = {
  title: "Components/ShelfTile",
  component: Tile,
  args: { shelf: aShelf(), viewerId: ADA.id },
} satisfies Meta<typeof Tile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OwnShelf: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Space operas")).toBeInTheDocument();
    await expect(canvas.getByText("Hand-picked")).toBeInTheDocument();
    await expect(canvas.getByText("Private")).toBeInTheDocument();
    await expect(canvas.getByText("2 books")).toBeInTheDocument();
    await expect(canvas.getByText("You")).toBeInTheDocument();
  },
};

export const MembersWithCoversStandOnTheLedge: Story = {
  args: { shelf: aShelf({ covers: [cover(1), cover(2)], bookCount: 6 }) },
  play: async ({ canvasElement }) => {
    const books = canvasElement.querySelectorAll(".shv-ledge-book");
    await expect(books).toHaveLength(2);
    await expect(books[0]?.querySelector("img")).toHaveAttribute(
      "src",
      `/api/thumbs/${cover(1)}/sm`,
    );
  },
};

export const MembersWithoutCoversStandAsBlankPlates: Story = {
  args: { shelf: aShelf({ bookCount: 9 }) },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll(".shv-ledge-book--blank"),
    ).toHaveLength(4);
  },
};

export const SingularCount: Story = {
  args: { shelf: aShelf({ bookCount: 1 }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("1 book")).toBeInTheDocument();
  },
};

export const EmptyShelves: Story = {
  args: {
    shelf: aShelf({ bookCount: 0, kind: "smart", visibility: "public" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No matches yet")).toBeInTheDocument();
    await expect(canvas.getByText("Smart")).toBeInTheDocument();
    await expect(canvas.getByText("Public")).toBeInTheDocument();
  },
};

export const SomeoneElsesShelfNamesItsOwner: Story = {
  args: {
    shelf: aShelf({
      owner: { id: 9 as UserId, name: "grace", hasAvatar: false },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("by grace")).toBeInTheDocument();
  },
};

export const WishlistShowsTheBareOwnerName: Story = {
  args: {
    shelf: aShelf({
      kind: "wishlist",
      name: "grace's Wishlist",
      owner: { id: 9 as UserId, name: "grace", hasAvatar: false },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Wishlist")).toBeInTheDocument();
    await expect(canvas.getByText("grace")).toBeInTheDocument();
    await expect(canvas.queryByText("by grace")).not.toBeInTheDocument();
  },
};
