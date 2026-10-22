import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { MetadataOverrides } from "../../api/generated/schemas";
import { ToastProvider } from "../../components/Toast/Toast";
import {
  bookDetailHandlers,
  failing,
  filterOptionHandlers,
  hanging,
  physicalHandlers,
  shelvesHandlers,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireShelf,
  aWireWishlist,
  WIRE_ADA,
} from "../../testing/wire";
import { BookChips } from "./BookChips";
import { type BookDialog, BookDialogs } from "./BookDialogs";
import { bookQuery } from "./queries";
import "./BookDetail.css";
import "./BookPage.css";

const THIS = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const BOOK = aWireBook({
  genres: ["Science fiction"],
  subjects: ["Space opera", "First contact"],
});
const writes: string[] = [];
const saved: MetadataOverrides[] = [];
// The book as the server holds it, which an edit changes for the next read.
let stored = BOOK;

/** The chips with the dialogs and toasts the page gives them, reading the book as BookDetail does, so an edit shows. */
function Chips(props: { book: ReturnType<typeof toBookDetail> }) {
  const [dialog, setDialog] = useState<BookDialog | null>(null);
  const book = useQuery(bookQuery(props.book.uuid)).data ?? props.book;
  return (
    <ToastProvider>
      <div className="bp-root">
        <BookChips book={book} onOpenDialog={setDialog} />
        <BookDialogs
          book={book}
          dialog={dialog}
          onClose={() => setDialog(null)}
        />
      </div>
    </ToastProvider>
  );
}

const meta = {
  title: "Pages/BookDetail/BookChips",
  component: Chips,
  args: { book: toBookDetail(BOOK) },
  beforeEach({ msw }) {
    writes.length = 0;
    saved.length = 0;
    stored = BOOK;
    msw.use(
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(stored)),
      ...shelvesHandlers([], {}, writes),
      ...filterOptionHandlers(),
      ...bookDetailHandlers(BOOK),
    );
  },
} satisfies Meta<typeof Chips>;

export default meta;
type Story = StoryObj<typeof meta>;

const READER = { ...WIRE_ADA, is_admin: false, can_edit: false };
const EDITOR = { ...WIRE_ADA, is_admin: false, can_edit: true };

/** `POST /api/ebooks/{uuid}/overrides`, answering with the book as the edit leaves it. */
const overrides = (answer: (edit: MetadataOverrides) => object | Response) =>
  http.post("/api/ebooks/:uuid/overrides", async ({ request }) => {
    const edit = MetadataOverrides.parse(await request.json());
    saved.push(edit);
    const result = answer(edit);
    if (result instanceof Response) return result;
    stored = { ...stored, ...result };
    return HttpResponse.json(stored);
  });

const editedBook = (edit: MetadataOverrides) => ({
  ...BOOK,
  ...(edit.genres && { genres: edit.genres }),
  ...(edit.subjects && { subjects: edit.subjects }),
});

const MINE = aWireShelf({ id: 7, name: "Space operas", book_count: 2 });
const SMART = aWireShelf({
  id: 3,
  kind: "smart",
  name: "Unread sci-fi",
  book_count: 5,
});
const GRACES = aWireShelf({
  id: 9,
  name: "Grace's picks",
  owner_user_id: 9,
  owner_username: "grace",
});
const WISHLIST = aWireShelf({
  id: 11,
  kind: "wishlist",
  name: "Ada's Wishlist",
  book_count: 1,
});

export const ReadersSeeChipsTheyCannotEdit: Story = {
  parameters: { user: READER },
  play: async ({ canvas }) => {
    await canvas.findByText("On no shelves yet");
    await expect(canvas.getByText("Science fiction")).toBeInTheDocument();
    await expect(canvas.getByText("Space opera")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("combobox", { name: "Add tag" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: /^Remove tag/ }),
    ).not.toBeInTheDocument();
  },
};

export const AReaderWithNoGenresSeesNoGenreRow: Story = {
  parameters: { user: READER },
  args: { book: toBookDetail({ ...BOOK, genres: [] }) },
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/ebooks/:uuid", () =>
        HttpResponse.json({ ...BOOK, genres: [] }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByText("On no shelves yet");
    await expect(canvas.queryByText("Genres")).not.toBeInTheDocument();
  },
};

export const EditorRemovesATagAndItSaves: Story = {
  parameters: { user: EDITOR },
  beforeEach({ msw }) {
    msw.use(overrides(editedBook));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove tag Space opera" }),
    );

    await waitFor(() =>
      expect(saved).toEqual([{ subjects: ["First contact"] }]),
    );
    await expect(
      await canvas.findByText("Removed the Space opera tag"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.queryByText("Space opera")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByText("First contact")).toBeInTheDocument();
  },
};

export const EditorAddsAGenre: Story = {
  beforeEach({ msw }) {
    msw.use(overrides(editedBook));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("combobox", { name: "Add genre" }),
      "Space western{Enter}",
    );

    await waitFor(() =>
      expect(saved).toEqual([{ genres: ["Science fiction", "Space western"] }]),
    );
    await expect(await canvas.findByText("Space western")).toBeInTheDocument();
  },
};

export const ARefusedChipEditPutsTheChipBack: Story = {
  beforeEach({ msw }) {
    msw.use(overrides(() => new Response("failed with 500", { status: 500 })));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove tag Space opera" }),
    );

    await expect(
      await canvas.findByText("Couldn't save that change"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByText("Space opera")).toBeInTheDocument(),
    );
  },
};

export const ShelvesListHeldAndAutomaticShelves: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...physicalHandlers({ wishlist: aWireWishlist() }),
      ...shelvesHandlers(
        [SMART, WISHLIST, MINE, GRACES],
        { manual: [7], smart: [3] },
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    const shelves = within(await canvas.findByTestId("bp-shelves"));
    // Hand-picked, then smart, then the wishlist; the shelf of someone else's isn't held.
    await expect(
      shelves.getAllByRole("link").map((a) => a.getAttribute("href")),
    ).toEqual(["/shelves/7", "/shelves/3", "/shelves/11"]);
    await expect(
      shelves.getByRole("link", { name: "Space operas" }),
    ).toBeInTheDocument();
    // Only the hand-picked one can come off.
    await expect(
      shelves.getAllByRole("button").map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Take off Space operas"]);
    await expect(
      canvas.getByRole("button", { name: "Add to shelf" }),
    ).toBeInTheDocument();
  },
};

export const WishlistChipOnlyWhileTheBookIsWished: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE, WISHLIST], { manual: [7] }, writes));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-shelves");
    await expect(canvas.queryByTestId("bp-shelf-11")).not.toBeInTheDocument();
  },
};

export const AddToShelfOpensThePicker: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], {}, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bp-add-to-shelf"));

    await expect(
      await canvas.findByRole("dialog", { name: "Add to shelf" }),
    ).toBeInTheDocument();
  },
};

export const TakingTheBookOffAShelfFromItsChip: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], { manual: [7] }, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Take off Space operas" }),
    );

    await waitFor(() => expect(writes).toEqual(["remove:7"]));
    await waitFor(() =>
      expect(canvas.queryByTestId("bp-shelf-7")).not.toBeInTheDocument(),
    );
    await canvas.findByText("On no shelves yet");
  },
};

export const PickerAddsTheBookAndTheChip: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], {}, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bp-add-to-shelf"));
    const dialog = await canvas.findByRole("dialog", { name: "Add to shelf" });
    const tile = await within(dialog).findByRole("checkbox", {
      name: "Space operas",
    });
    await expect(tile).not.toBeChecked();

    await userEvent.click(tile);

    await waitFor(() => expect(writes).toEqual(["add:7"]));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("checkbox", { name: "Space operas" }),
      ).toBeChecked(),
    );
    await userEvent.click(within(dialog).getByTestId("shelf-picker-close"));
    await expect(await canvas.findByTestId("bp-shelf-7")).toHaveTextContent(
      "Space operas",
    );
    await expect(
      canvas.queryByText("On no shelves yet"),
    ).not.toBeInTheDocument();
  },
};

let releaseStaleRead = () => {};

function RefetchShelves() {
  const client = useQueryClient();
  return (
    <button
      type="button"
      onClick={() =>
        void client.invalidateQueries({ queryKey: ["book", THIS, "shelves"] })
      }
    >
      Refetch shelves
    </button>
  );
}

export const AToggleSurvivesAReadStartedBeforeIt: Story = {
  render: (args) => (
    <>
      <RefetchShelves />
      <Chips {...args} />
    </>
  ),
  beforeEach({ msw }) {
    const held = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    let reads = 0;
    msw.use(
      // The second read asks before the toggle and answers after it.
      http.get("/api/shelves/containing/:uuid", async () => {
        if (reads++ === 1) {
          await held;
          return HttpResponse.json([]);
        }
        return HttpResponse.json(writes.includes("add:7") ? [7] : []);
      }),
      ...shelvesHandlers([MINE], {}, writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bp-add-to-shelf"));
    await userEvent.click(
      canvas.getByRole("button", { name: "Refetch shelves" }),
    );
    const dialog = canvas.getByRole("dialog", { name: "Add to shelf" });
    await userEvent.click(
      await within(dialog).findByRole("checkbox", { name: "Space operas" }),
    );
    await waitFor(() => expect(writes).toEqual(["add:7"]));

    releaseStaleRead();
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      within(dialog).getByRole("checkbox", { name: "Space operas" }),
    ).toBeChecked();
  },
};

export const PickerRemovesTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], { manual: [7] }, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("bp-shelf-7");
    await userEvent.click(canvas.getByTestId("bp-add-to-shelf"));
    const dialog = await canvas.findByRole("dialog");

    await userEvent.click(
      await within(dialog).findByRole("checkbox", { name: "Space operas" }),
    );

    await waitFor(() => expect(writes).toEqual(["remove:7"]));
    await userEvent.click(within(dialog).getByTestId("shelf-picker-close"));
    await waitFor(() =>
      expect(canvas.queryByTestId("bp-shelf-7")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("bp-add-to-shelf")).toBeInTheDocument();
  },
};

export const PickerFailureLeavesTheChipAsItWas: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], {}, writes, 7));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bp-add-to-shelf"));
    const dialog = await canvas.findByRole("dialog");
    await userEvent.click(
      await within(dialog).findByRole("checkbox", { name: "Space operas" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t update Space operas: failed with 500",
    );
    await expect(
      within(dialog).getByRole("checkbox", { name: "Space operas" }),
    ).not.toBeChecked();
    await expect(writes).toEqual([]);
    await expect(canvas.queryByTestId("bp-shelf-7")).not.toBeInTheDocument();
  },
};

export const PickerListsOnlyShelvesTheReaderMayChange: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(
      ...shelvesHandlers(
        [MINE, GRACES, SMART, WISHLIST],
        { smart: [3] },
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bp-add-to-shelf"));
    const dialog = await canvas.findByRole("dialog");

    await within(dialog).findByRole("checkbox", { name: "Space operas" });
    await expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    // The smart shelf matching the book is shown, but not as something to tick.
    await expect(
      within(dialog).getByTestId("shelf-picker-auto-3"),
    ).toHaveTextContent("Unread sci-fi");
  },
};

export const ShelvesLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Checking your shelves")).toBeInTheDocument();
    await expect(
      canvas.queryByText("On no shelves yet"),
    ).not.toBeInTheDocument();
  },
};

export const ShelvesFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/shelves/containing/:uuid/smart", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("bp-shelves-unavailable"),
    ).toHaveTextContent(
      "Your shelves didn’t load — see them on the library page →",
    );
    await expect(
      canvas.queryByText("On no shelves yet"),
    ).not.toBeInTheDocument();
  },
};

export const OnNoShelvesYetBesideTheAddChip: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("On no shelves yet"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Add to shelf" }),
    ).toBeInTheDocument();
  },
};
