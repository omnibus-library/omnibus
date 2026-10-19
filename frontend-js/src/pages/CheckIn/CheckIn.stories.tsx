import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import {
  expectInvalidated,
  seedQueries,
  storyClient,
} from "../../testing/AppHarness";
import {
  aScanBook,
  googleBooksHandler,
  NEW_BOOK_UUID,
} from "../../testing/scanHandlers";
import {
  BOOK,
  CLOSE_MATCH,
  checkedIn,
  handlers,
  ISBN,
  lookUp,
  ONLINE,
  Page,
  physicalOnly,
  resetCheckIn,
  resolved,
  wishlisted,
} from "./CheckIn.stories.shared";

// What a check-in marks stale for the lists and the book page.
const CHECK_IN_KEYS = [
  ["books"],
  ["shelves"],
  ["shelf-page"],
  ["book", BOOK.uuid],
];
const gate = { release: () => {} };

const meta = {
  title: "Pages/CheckIn",
  component: Page,
  parameters: { path: "/check-in" },
  beforeEach: resetCheckIn,
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lookup: Story = {
  play: async ({ canvas, userEvent }) => {
    const screen = await canvas.findByTestId("check-in-lookup");
    await expect(canvas.getByTestId("check-in")).toHaveClass(
      "card",
      "check-in",
    );
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Check in a book" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-close")).toHaveAttribute(
      "href",
      "/",
    );
    await expect(canvas.getByLabelText("Cancel check-in")).toBeInTheDocument();
    await expect(screen).toHaveTextContent(
      "Enter the ISBN from the back cover",
    );
    const submit = canvas.getByTestId("check-in-submit");
    await expect(submit).toBeDisabled();

    const field = canvas.getByLabelText("ISBN");
    await userEvent.type(field, "9780134685992");
    await expect(submit).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "978-0-13-468599-1");
    await expect(submit).toBeEnabled();
    await expect(canvas.queryByTestId("check-in-google-books-note")).toBeNull();
  },
};

export const WithoutAGoogleBooksKey: Story = {
  beforeEach({ msw }) {
    msw.use(googleBooksHandler(false));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("check-in-google-books-note"),
    ).toHaveTextContent(/Open Library.*Administration › Integrations\.$/);
  },
};

export const ShowsMatchingWhileResolving: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    msw.use(
      ...handlers(
        { kind: "in_library_unowned", book: BOOK },
        { gate: new Promise<void>((r) => (release = r)) },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    const resolving = await canvas.findByTestId("check-in-resolving");
    await expect(resolving).toHaveTextContent("Matching…");
    await expect(resolving).toHaveTextContent(
      "Checking your library, then the web.",
    );
    await expect(resolved).toEqual([ISBN]);

    gate.release();
    await canvas.findByTestId("check-in-confirm");
  },
};

export const LookupFailsAndKeepsTheIsbn: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "unresolved" },
        { refuse: { resolve: "providers are down" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not look that up: providers are down",
    );
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
  },
};

export const OpensABookAlreadyOwned: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "already_owned", book: BOOK }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};

export const StaysPutWhenLeftBeforeTheBookIsFound: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    msw.use(
      ...handlers(
        { kind: "already_owned", book: BOOK },
        { gate: new Promise<void>((r) => (release = r)) },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("check-in-close"));
    await expect(
      await canvas.findByRole("heading", { name: "Library" }),
    ).toBeInTheDocument();

    gate.release();
    await waitFor(() => expect(storyClient().isMutating()).toBe(0));

    await expect(canvas.queryByText("Book page")).toBeNull();
    await expect(
      canvas.getByRole("heading", { name: "Library" }),
    ).toBeInTheDocument();
  },
};

export const PrefillsTheIsbnFromTheLink: Story = {
  parameters: { path: `/check-in?isbn=${ISBN}` },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("check-in-isbn")).toHaveValue(ISBN);
    await expect(canvas.getByTestId("check-in-submit")).toBeEnabled();
  },
};

export const ConfirmsACopyOfALibraryBook: Story = {
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    const confirm = await canvas.findByTestId("check-in-confirm");
    await expect(confirm).toHaveTextContent("Check in this copy");
    await expect(confirm).toHaveTextContent(
      "You already have this one digitally — this adds your print copy.",
    );
    await expect(canvas.getByText("The Salt Road")).toBeInTheDocument();
    await expect(
      canvas.getByText("Mara Okafor and Jun Aoki"),
    ).toBeInTheDocument();
    await expect(confirm).toHaveTextContent(`Entered ISBN ${ISBN}`);
    await userEvent.type(canvas.getByLabelText(/Edition note/), "  Paperback ");
    seedQueries(CHECK_IN_KEYS);

    await userEvent.click(canvas.getByTestId("check-in-confirm-submit"));

    const done = await canvas.findByTestId("check-in-success");
    await expect(done).toHaveTextContent("In your physical collection");
    await expect(done).toHaveTextContent("The Salt Road");
    await expect(canvas.getByTestId("check-in-view-book")).toHaveAttribute(
      "href",
      `/books/${BOOK.uuid}`,
    );
    await expect(canvas.queryByTestId("check-in-off-wishlist")).toBeNull();
    await expect(checkedIn).toEqual([
      { book_uuid: BOOK.uuid, isbn: ISBN, note: "Paperback" },
    ]);
    await expectInvalidated(CHECK_IN_KEYS);
  },
};

export const TakesAWishlistedBookOffTheWishlist: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "on_wishlist", book: BOOK }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(
      "This one is on your wishlist — checking your copy in takes it off.",
    );
    await userEvent.click(canvas.getByTestId("check-in-confirm-submit"));

    await expect(
      await canvas.findByTestId("check-in-off-wishlist"),
    ).toHaveTextContent("Checked in and taken off your wishlist.");
    await expect(checkedIn).toEqual([{ book_uuid: BOOK.uuid, isbn: ISBN }]);
  },
};

export const CheckInFailsAndStays: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "in_library_unowned", book: BOOK },
        { refuse: { checkIn: "book not found" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("check-in-confirm-submit"));

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Check-in failed: book not found",
    );
    await expect(canvas.getByTestId("check-in-confirm")).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-confirm-submit")).toBeEnabled();
  },
};

export const CancelRestartsToAnEmptyLookup: Story = {
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    await userEvent.type(await canvas.findByLabelText(/Edition note/), "x");

    await userEvent.click(canvas.getByTestId("check-in-cancel"));

    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue("");
  },
};

export const AsksAboutOneCloseMatch: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers(CLOSE_MATCH([])));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    const screen = await canvas.findByTestId("check-in-close-match");
    await expect(screen).toHaveTextContent("Is this the book?");
    await expect(screen).toHaveTextContent(
      "Library edition ISBN 9781111111111",
    );
    await expect(screen).toHaveTextContent(`Entered ISBN ${ONLINE.isbn13}`);

    await userEvent.click(
      canvas.getByRole("button", { name: "Yes, that's it" }),
    );
    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Entered ISBN ${ONLINE.isbn13}`);
  },
};

export const AsksWhichOfSeveralCloseMatches: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        CLOSE_MATCH([aScanBook({ uuid: "other", title: "Salt Road Omnibus" })]),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-close-match"),
    ).toHaveTextContent("Which one is this?");
    await expect(
      canvas.getAllByTestId("check-in-close-match-pick"),
    ).toHaveLength(2);

    await userEvent.click(
      canvas.getByRole("button", { name: "None of these" }),
    );
    await expect(
      await canvas.findByTestId("check-in-choose"),
    ).toHaveTextContent("Harbour Lights");
  },
};

export const OffersAnOnlineBookToOwnOrWishlist: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    const choose = await canvas.findByTestId("check-in-choose");
    await expect(choose).toHaveTextContent("Not in your library");
    await expect(canvas.getByTestId("check-in-book-series")).toHaveTextContent(
      "Tidewater (2)",
    );
    await expect(choose).toHaveTextContent("Ines Varga · 2021");
    await expect(canvas.getByTestId("check-in-book-detail")).toHaveTextContent(
      "First published 2019 · Lantern Press · 320 pages",
    );

    await userEvent.click(canvas.getByTestId("check-in-own-it"));

    await expect(
      await canvas.findByTestId("check-in-success"),
    ).toHaveTextContent("In your physical collection");
    await expect(physicalOnly).toEqual([{ meta: ONLINE }]);
    await expect(canvas.getByTestId("check-in-view-book")).toHaveAttribute(
      "href",
      `/books/${NEW_BOOK_UUID}`,
    );
  },
};

export const WishlistsAnOnlineBook: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("check-in-wishlist"));

    const done = await canvas.findByTestId("check-in-success");
    await expect(done).toHaveTextContent("On your wishlist");
    await expect(done).toHaveTextContent("Harbour Lights");
    await expect(done).toHaveTextContent("Wishlisted books have no files");
    await expect(canvas.queryByTestId("check-in-view-book")).toBeNull();
    await expect(wishlisted).toEqual([{ meta: ONLINE, source: "manual" }]);

    await userEvent.click(canvas.getByTestId("check-in-scan-another"));
    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue("");
  },
};

export const OnlineBookWritesFailAndStay: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "not_in_library", online: ONLINE },
        { refuse: { physicalOnly: "no room", wishlist: "list is full" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    await userEvent.click(await canvas.findByTestId("check-in-own-it"));
    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not add that book: no room",
    );
    await userEvent.click(canvas.getByTestId("check-in-wishlist"));
    await expect(
      await canvas.findByText("Could not add to your wishlist: list is full"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-choose")).toBeInTheDocument();
  },
};

export const ChooserRestartsOnWrongBook: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("check-in-restart"));

    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
  },
};

export const UnresolvedIsbn: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });

    const screen = await canvas.findByTestId("check-in-unresolved");
    await expect(screen).toHaveTextContent("We couldn't find that ISBN");
    await expect(screen).toHaveTextContent(
      `Nothing in your library or our metadata providers matches ${ISBN}.`,
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Try another ISBN" }),
    );
    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
  },
};
