import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect } from "storybook/test";
import type {
  AddPhysicalOnlyRequest,
  CheckInRequest,
  ExternalBookMeta,
  ScanOutcome,
  WishlistAddRequest,
} from "../../api/generated/schemas";
import { storyClient } from "../../testing/AppHarness";
import { failing, paletteHandler } from "../../testing/handlers";
import {
  anExternalBook,
  aScanBook,
  googleBooksHandler,
  NEW_BOOK_UUID,
  scanHandlers,
} from "../../testing/scanHandlers";
import { aWirePalette, aWirePaletteBook } from "../../testing/wire";
import { CheckIn } from "./CheckIn";

const ISBN = "9780134685991";
const BOOK = aScanBook();
const ONLINE = anExternalBook();

const resolved: string[] = [];
const resolvedMeta: ExternalBookMeta[] = [];
const searched: string[] = [];
const checkedIn: CheckInRequest[] = [];
const physicalOnly: AddPhysicalOnlyRequest[] = [];
const wishlisted: WishlistAddRequest[] = [];
const gate = { release: () => {} };

/** The page, with stand-ins for where it leaves to. */
function Page() {
  return (
    <Routes>
      <Route path="/" element={<CheckIn />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  );
}

const handlers = (
  outcome: ScanOutcome,
  options: Parameters<typeof scanHandlers>[1] = {},
) =>
  scanHandlers(outcome, {
    resolved,
    resolvedMeta,
    searched,
    found: [
      ONLINE,
      anExternalBook({
        isbn13: "9780306406157",
        title: "Harbour Lights Revisited",
      }),
    ],
    checkedIn,
    physicalOnly,
    wishlisted,
    ...options,
  });

const meta = {
  title: "Pages/CheckIn",
  component: Page,
  beforeEach({ msw }) {
    for (const list of [
      resolved,
      resolvedMeta,
      searched,
      checkedIn,
      physicalOnly,
      wishlisted,
    ]) {
      list.length = 0;
    }
    msw.use(
      ...handlers({ kind: "in_library_unowned", book: BOOK }),
      googleBooksHandler(true),
    );
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;
type Ctx = Parameters<NonNullable<Story["play"]>>[0];

/** Types an ISBN into the lookup and submits it. */
async function lookUp({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.type(await canvas.findByTestId("check-in-isbn"), ISBN);
  await userEvent.click(canvas.getByTestId("check-in-submit"));
}

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
    for (const key of ["books", "shelves", "shelf-page"]) {
      storyClient().setQueryData([key], []);
    }
    storyClient().setQueryData(["book", BOOK.uuid], {});

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
    for (const key of [
      ["books"],
      ["shelves"],
      ["shelf-page"],
      ["book", BOOK.uuid],
    ]) {
      await expect(storyClient().getQueryState(key)?.isInvalidated).toBe(true);
    }
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

const CLOSE_MATCH = (others: ReturnType<typeof aScanBook>[]): ScanOutcome => ({
  kind: "close_match",
  book: aScanBook({ isbn: "9781111111111" }),
  others,
  scanned: ONLINE,
});

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

/** Searches the lookup's title field and waits for the results. */
async function searchTitle({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.type(await canvas.findByLabelText("Title"), "  harbour ");
  await userEvent.click(canvas.getByTestId("check-in-search-submit"));
  await canvas.findByTestId("check-in-search-results");
}

export const SearchesByTitleBesideTheIsbnField: Story = {
  play: async ({ canvas, userEvent }) => {
    const submit = await canvas.findByTestId("check-in-search-submit");
    await expect(canvas.getByTestId("check-in-or")).toHaveTextContent("or");
    await expect(submit).toBeDisabled();

    await searchTitle({ canvas, userEvent });

    await expect(searched).toEqual(["harbour"]);
    const results = canvas.getAllByTestId("check-in-search-result");
    await expect(results).toHaveLength(2);
    await expect(results[0]).toHaveTextContent("Harbour Lights");
    await expect(results[0]).toHaveTextContent("Ines Varga · 2021");
    await expect(canvas.getByTestId("check-in-isbn")).toBeInTheDocument();
  },
};

export const SearchWithNoMatches: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }, { found: [] }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Title"), "zzz");
    await userEvent.click(canvas.getByTestId("check-in-search-submit"));

    await expect(
      await canvas.findByTestId("check-in-search-empty"),
    ).toHaveTextContent("No books match that title.");
  },
};

export const SearchFailsAndKeepsTheResults: Story = {
  beforeEach({ msw }) {
    let calls = 0;
    msw.use(
      http.post("/api/scan/search", () =>
        ++calls === 1
          ? HttpResponse.json({ results: [ONLINE] })
          : new HttpResponse("providers are down", { status: 503 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });

    await userEvent.click(canvas.getByTestId("check-in-search-submit"));

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not search: providers are down",
    );
    await expect(
      canvas.getByTestId("check-in-search-results"),
    ).toBeInTheDocument();
  },
};

export const PickingAResultResolvesItBySearch: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await canvas.findByTestId("check-in-choose");
    await expect(resolvedMeta).toEqual([ONLINE]);
    await expect(resolved).toEqual([]);
    await userEvent.click(canvas.getByTestId("check-in-wishlist"));
    await canvas.findByTestId("check-in-success");
    await expect(wishlisted).toEqual([{ meta: ONLINE, source: "search" }]);
  },
};

export const PickedResultInTheLibraryConfirmsWithTheEditionsIsbn: Story = {
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`ISBN ${ONLINE.isbn13}, from the edition you picked`);
  },
};

export const PickedResultAlreadyOwnedOpensTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "already_owned", book: BOOK }));
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};

export const PickFailsAndKeepsTheResults: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "unresolved" },
        { refuse: { resolveMeta: "no match" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not match that book: no match",
    );
    await expect(
      canvas.getByTestId("check-in-search-results"),
    ).toBeInTheDocument();
  },
};

export const ClosePickedResultWordsTheSubtitleBySearch: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers(CLOSE_MATCH([])));
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(
      await canvas.findByTestId("check-in-close-match"),
    ).toHaveTextContent(
      "That edition's ISBN isn't on any book in your library",
    );
  },
};

const LIBRARY = aWirePalette({
  books: [
    aWirePaletteBook({
      uuid: "11111111-1111-4111-8111-111111111111",
      title: "Harbour Lights (print)",
      author_display: "Varga, Ines",
      formats: ["EPUB"],
    }),
    aWirePaletteBook({
      uuid: "22222222-2222-4222-8222-222222222222",
      title: "Lights of the Harbour",
      author_display: "",
      formats: [],
    }),
  ],
  book_total: 7,
});

const toLink = async ({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) => {
  await lookUp({ canvas, userEvent });
  await userEvent.click(await canvas.findByTestId("check-in-link-existing"));
  await canvas.findByTestId("check-in-link");
};

export const LinksACopyToABookOnTheShelf: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "not_in_library", online: ONLINE }),
      paletteHandler(LIBRARY),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await expect(canvas.getByTestId("check-in-link")).toHaveTextContent(
      "Which book is this?",
    );
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(
      canvas.getByRole("button", { name: "Search my library" }),
    );

    const picks = await canvas.findAllByTestId("check-in-link-pick");
    await expect(picks).toHaveLength(2);
    await expect(
      canvas.getByTestId("check-in-link-truncated"),
    ).toHaveTextContent(
      "Showing 2 of 7 matches — add the author or more of the title.",
    );
    await expect(canvas.getByText("Varga, Ines")).toBeInTheDocument();

    await userEvent.click(picks[0] as HTMLElement);

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent("You already have this one digitally");
    await userEvent.click(canvas.getByTestId("check-in-confirm-submit"));
    await canvas.findByTestId("check-in-success");
    await expect(checkedIn).toEqual([
      {
        book_uuid: "11111111-1111-4111-8111-111111111111",
        isbn: ONLINE.isbn13,
      },
    ]);
    await expect(physicalOnly).toEqual([]);
  },
};

export const LinkSearchWithNoMatches: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "not_in_library", online: ONLINE }),
      paletteHandler(aWirePalette({ books: [] })),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText("Title or author"), "nothing");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));

    await expect(
      await canvas.findByTestId("check-in-link-empty"),
    ).toHaveTextContent("No book in your library matches that.");
    await expect(canvas.queryByTestId("check-in-link-truncated")).toBeNull();
  },
};

export const LinkSearchFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "not_in_library", online: ONLINE }),
      failing("get", "/api/search/palette", 500),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not search your library: failed with 500",
    );
  },
};

export const LinkBackRestoresTheChooser: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });

    await userEvent.click(canvas.getByTestId("check-in-link-back"));

    await expect(
      await canvas.findByTestId("check-in-choose"),
    ).toHaveTextContent("Harbour Lights");
  },
};

export const LinkFromUnresolvedConfirmsWithTheTypedIsbn: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }), paletteHandler(LIBRARY));
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));
    await userEvent.click(
      (await canvas.findAllByTestId("check-in-link-pick"))[1] as HTMLElement,
    );
    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Entered ISBN ${ISBN}`);
  },
};

export const UnresolvedOffersTitleSearchInstead: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }));
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("check-in-search-instead"));

    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("check-in-error")).toBeNull();
  },
};

export const LinkBackRestoresUnresolved: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }));
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });

    await userEvent.click(canvas.getByTestId("check-in-link-back"));

    await expect(
      await canvas.findByTestId("check-in-unresolved"),
    ).toHaveTextContent(ISBN);
  },
};

/** A stand-in for the vendored glue, which would open a real camera; `then` plays its callbacks once started. */
function fakeCamera(then: () => void) {
  window.OmnibusScanner = {
    async start() {
      then();
    },
    stop() {},
    setTorch() {},
  };
  return () => {
    delete window.OmnibusScanner;
  };
}

const ready = () => window.__omnibusOnScanStatus?.("ready");

/** Presses "Scan a barcode" on the lookup. */
async function openScanner({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.click(await canvas.findByTestId("check-in-scan-instead"));
}

export const LookupLoadsNoScanner: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("check-in-lookup");
    await expect(
      document.head.querySelectorAll(
        'script[src*="zxing"], script[src*="barcode-scanner"]',
      ),
    ).toHaveLength(0);
    await expect(canvas.queryByTestId("barcode-scanner")).toBeNull();
  },
};

export const ScanBarcodeOpensTheScanner: Story = {
  beforeEach: () => fakeCamera(ready),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");

    const screen = canvas.getByTestId("check-in-scan");
    await expect(screen).toHaveTextContent("Scan a barcode");
    await expect(screen).toHaveTextContent(
      "Hold the back cover in the frame — we'll read the ISBN automatically.",
    );
    await expect(
      await canvas.findByTestId("barcode-scanner-status"),
    ).toHaveTextContent("Point the camera at the barcode on the back cover.");
    await expect(
      canvas.getByTestId("check-in-search-by-title"),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("check-in-search-by-title"));
    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
  },
};

export const ADetectionResolvesAsScanned: Story = {
  beforeEach: () =>
    fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.(ISBN);
    }),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Scanned ISBN ${ISBN}`);
    await expect(resolved).toEqual([ISBN]);
  },
};

export const ARejectedDecodeLandsOnTheKeypadWithTheDigits: Story = {
  beforeEach: () =>
    fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.("9780134685992");
    }),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-entry"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(
      "9780134685992",
    );
    await expect(canvas.getByTestId("check-in-error")).toHaveTextContent(
      "ISBN has an invalid check digit",
    );
    await expect(resolved).toEqual([]);
  },
};

export const AFailedScanLookupLandsOnTheKeypad: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "unresolved" },
        { refuse: { resolve: "providers are down" } },
      ),
    );
    return fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.(ISBN);
    });
  },
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-entry"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-error")).toHaveTextContent(
      "Could not look that up: providers are down",
    );
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
  },
};

export const TheCameraDeniedOffersTheKeypad: Story = {
  beforeEach: () => fakeCamera(() => window.__omnibusOnScanStatus?.("denied")),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");
    await userEvent.click(await canvas.findByTestId("barcode-scanner-manual"));

    await expect(
      await canvas.findByTestId("check-in-entry"),
    ).toBeInTheDocument();
  },
};

export const KeypadBuildsAnIsbnKeyByKey: Story = {
  beforeEach: () => fakeCamera(() => window.__omnibusOnScanStatus?.("denied")),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");
    await userEvent.click(await canvas.findByTestId("barcode-scanner-manual"));
    const screen = await canvas.findByTestId("check-in-entry");
    await expect(screen).toHaveTextContent("Enter the ISBN");
    await expect(screen).toHaveTextContent(
      "It's the 13-digit number under the barcode on the back cover.",
    );
    const progress = canvas.getByTestId("check-in-isbn-progress");
    await expect(progress.querySelectorAll(".isbn-slot")).toHaveLength(13);
    const submit = canvas.getByTestId("check-in-submit");

    for (const key of ISBN.slice(0, 12)) {
      await userEvent.click(canvas.getByTestId(`check-in-key-${key}`));
    }
    await expect(progress).toHaveAttribute("data-filled", "12");
    await expect(progress.querySelectorAll(".isbn-slot.filled")).toHaveLength(
      12,
    );
    await expect(submit).toBeDisabled();

    await userEvent.click(canvas.getByTestId("check-in-key-2"));
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await userEvent.click(canvas.getByTestId("check-in-key-1"));
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
    await expect(submit).toBeEnabled();

    // A thirteenth slot is the last one.
    await userEvent.click(canvas.getByTestId("check-in-key-7"));
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
    await expect(progress).toHaveAttribute("data-filled", "13");

    await userEvent.click(submit);
    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Entered ISBN ${ISBN}`);
    await expect(resolved).toEqual([ISBN]);
  },
};

export const KeypadGoesBackToTheScannerOrToTitleSearch: Story = {
  beforeEach: () => fakeCamera(() => window.__omnibusOnScanStatus?.("denied")),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");
    await userEvent.click(await canvas.findByTestId("barcode-scanner-manual"));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Scan a barcode instead" }),
    );
    await expect(
      await canvas.findByTestId("check-in-scan"),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("barcode-scanner-manual"));
    await userEvent.click(
      await canvas.findByTestId("check-in-search-by-title"),
    );
    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
  },
};
