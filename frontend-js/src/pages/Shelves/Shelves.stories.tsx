import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import type { CreateShelfRequest } from "../../api/generated/schemas";
import {
  createShelfHandler,
  failing,
  hanging,
  shelvesHandler,
} from "../../testing/handlers";
import { aWireShelf, aWireShelfDetail, WIRE_ADA } from "../../testing/wire";
import { Shelves } from "./Shelves";

const created: CreateShelfRequest[] = [];

const BOB = { owner_user_id: 2, owner_username: "bob" };

const SHELVES = [
  aWireShelf({ id: 3, name: "Winter reads", book_count: 3 }),
  aWireShelf({
    id: 4,
    kind: "smart",
    name: "Yearlies",
    visibility: "public",
    book_count: 9,
  }),
  aWireShelf({ id: 5, kind: "wishlist", name: "Wishlist", book_count: 1 }),
  aWireShelf({
    id: 6,
    name: "Bob’s picks",
    visibility: "public",
    book_count: 4,
    ...BOB,
  }),
  aWireShelf({ id: 7, name: "Bob’s secret", book_count: 2, ...BOB }),
];

const meta = {
  title: "Pages/Shelves",
  component: Shelves,
  parameters: { path: "/shelves" },
  beforeEach({ msw }) {
    localStorage.removeItem("omnibus.discovery_prefs");
    created.length = 0;
    msw.use(shelvesHandler(SHELVES));
  },
  render: () => (
    <Routes>
      <Route path="/shelves" element={<Shelves />} />
      <Route path="/shelves/:id" element={<p>The shelf</p>} />
    </Routes>
  ),
} satisfies Meta<typeof Shelves>;

export default meta;
type Story = StoryObj<typeof meta>;

const cardIds = (group: HTMLElement) =>
  within(group)
    .getAllByRole("link")
    .map((card) => card.getAttribute("data-testid"));

export const Loaded: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Shelves" }),
    ).toBeInTheDocument();
    await expect(await canvas.findByTestId("shelves-census")).toHaveTextContent(
      "5 shelves · 3 yours · 2 from 1 other reader",
    );
    await expect(
      canvas.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Your shelves", "bob’s shelves"]);
    const mine = canvas.getByRole("region", { name: "Your shelves" });
    await expect(cardIds(mine)).toEqual([
      "shelf-card-3",
      "shelf-card-4",
      "shelf-card-5",
    ]);
    await expect(within(mine).getByTestId("shelf-card-3")).toHaveAttribute(
      "href",
      "/shelves/3",
    );
    await expect(within(mine).getByTestId("shelf-card-3")).toHaveTextContent(
      "You",
    );
    const theirs = canvas.getByRole("region", { name: "bob’s shelves" });
    await expect(within(theirs).getByTestId("shelf-card-6")).toHaveTextContent(
      "bob",
    );
  },
};

export const AdminNote: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("shelves-admin-note"),
    ).toHaveTextContent(
      "Includes other readers’ private shelves — you can see them as an admin.",
    );
  },
};

export const NoAdminNoteForReaders: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  play: async ({ canvas }) => {
    await canvas.findByTestId("shelves-census");
    await expect(canvas.queryByTestId("shelves-admin-note")).toBeNull();
  },
};

export const OwnerChipNarrows: Story = {
  play: async ({ canvas, userEvent }) => {
    const bob = await canvas.findByTestId("shelves-owner-2");
    await expect(canvas.getByTestId("shelves-owner-1")).toHaveTextContent(
      "You",
    );

    await userEvent.click(bob);

    await expect(bob).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(
        canvas.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["bob’s shelves"]),
    );

    await userEvent.click(bob);

    await waitFor(() =>
      expect(canvas.getAllByRole("heading", { level: 2 })).toHaveLength(2),
    );
  },
};

export const KindFilter: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Hand-picked" }),
    );

    await waitFor(() =>
      expect(
        canvas.getAllByTestId(/^shelf-card-/).map((c) => c.dataset.testid),
      ).toEqual(["shelf-card-3", "shelf-card-6", "shelf-card-7"]),
    );
  },
};

export const TextFilterToNone: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", {
        name: "Filter shelves by name or owner",
      }),
      "zzz",
    );

    await expect(
      await canvas.findByText("No shelves match “zzz”."),
    ).toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear filters" }),
    );

    await expect(
      await canvas.findByRole("region", { name: "Your shelves" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("searchbox", {
        name: "Filter shelves by name or owner",
      }),
    ).toHaveValue("");
  },
};

export const FilterMatchesOwner: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", {
        name: "Filter shelves by name or owner",
      }),
      "bob secret",
    );

    await waitFor(() =>
      expect(canvas.getAllByTestId(/^shelf-card-/)).toHaveLength(1),
    );
    await expect(canvas.getByTestId("shelf-card-7")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(shelvesHandler([]));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("shelves-census")).toHaveTextContent(
      "No shelves yet",
    );
    await expect(
      canvas.getByText(
        "No shelves yet — gather books by hand, or let a rule fill one for you.",
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("shelves-empty-new")).toHaveTextContent(
      "＋ New shelf",
    );
    await expect(
      canvas.queryByRole("button", { name: "Clear filters" }),
    ).toBeNull();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering your shelves"),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/shelves", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
  },
};

export const SortByCount: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Most books" }),
    );

    await waitFor(() =>
      expect(
        cardIds(canvas.getByRole("region", { name: "Your shelves" })),
      ).toEqual(["shelf-card-4", "shelf-card-3", "shelf-card-5"]),
    );
    await expect(
      JSON.parse(localStorage.getItem("omnibus.discovery_prefs") ?? "{}"),
    ).toMatchObject({ shelves_sort: "book_count" });
  },
};

export const NewShelf: Story = {
  beforeEach({ msw }) {
    msw.use(
      createShelfHandler(created, {
        created: aWireShelfDetail({ id: 9, name: "Cosy reads" }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("new-shelf"));
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Shelf name" }),
      "Cosy reads",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Create" }));

    await expect(await canvas.findByText("The shelf")).toBeInTheDocument();
    await expect(created).toHaveLength(1);
  },
};

export const NewShelfFromEmpty: Story = {
  beforeEach({ msw }) {
    msw.use(shelvesHandler([]));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("shelves-empty-new"));

    await expect(
      await canvas.findByRole("dialog", { name: "New shelf" }),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(canvas.queryByRole("dialog", { name: "New shelf" })).toBeNull(),
    );
  },
};
