import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { ResolveMetaRequest } from "../../api/generated/schemas";
import { failing, hanging } from "../../testing/handlers";
import {
  aWireRequest,
  aWireVersion,
  type RequestFake,
  requestFake,
} from "../../testing/requestHandlers";
import { anExternalBook, aScanBook } from "../../testing/scanHandlers";
import {
  aWireBook,
  aWirePalette,
  aWirePaletteBook,
  WIRE_ADA,
} from "../../testing/wire";
import { BookRequest } from "../BookRequest/BookRequest";
import { PHONE } from "../Wishlists/Wishlists.stories.shared";
import { Requests } from "./Requests";

// Starting a request from the page's search: the library's books are the palette's, the providers' are a list of records.

const bookOf = (title: string, author: string) =>
  aWireBook({
    title,
    unique_identifier: `uuid-${title.toLowerCase()}`,
    creators: [{ name: author, role: null, file_as: null, id: 4 }],
    formats: [],
  });

const PIRANESI = bookOf("Piranesi", "Susanna Clarke");
const DUNE = bookOf("Dune", "Frank Herbert");
const DRACULA = bookOf("Dracula", "Bram Stoker");
const BOOKS = [PIRANESI, DUNE, DRACULA];

/** What the palette finds: a book with a print copy only, one with its ebook, and a second print-only one. */
const LIBRARY = [
  aWirePaletteBook({
    id: 1,
    uuid: "uuid-piranesi",
    title: "Piranesi",
    author_display: "Susanna Clarke",
    year: "2020",
    formats: [],
    has_physical: true,
  }),
  aWirePaletteBook({
    id: 2,
    uuid: "uuid-dune",
    title: "Dune",
    author_display: "Frank Herbert",
    year: "1965",
    formats: ["EPUB"],
  }),
  aWirePaletteBook({
    id: 3,
    uuid: "uuid-dracula",
    title: "Dracula",
    author_display: "Bram Stoker",
    year: "1897",
    formats: [],
    has_physical: true,
  }),
];

const READER = {
  ...WIRE_ADA,
  is_admin: false,
  can_request: true,
  book_requests: true,
};

/** What the providers know: a book the library lacks, and the library's Dracula, Dune and Piranesi under other editions. */
const RECORDS = [
  anExternalBook({
    isbn13: "9781408844175",
    title: "Jonathan Strange & Mr Norrell",
    authors: ["Susanna Clarke"],
    year: "2004",
    publisher: "Bloomsbury",
    series: null,
  }),
  anExternalBook({
    isbn13: "9780141439846",
    title: "Dracula (Penguin Classics)",
    authors: ["Bram Stoker"],
    year: "2003",
    publisher: "Penguin",
    series: null,
  }),
  anExternalBook({
    isbn13: "9780441172719",
    title: "Dune (Ace)",
    authors: ["Frank Herbert"],
    year: "1990",
    publisher: "Ace",
    series: null,
  }),
  anExternalBook({
    isbn13: "9781635575637",
    title: "Piranesi (Bloomsbury)",
    authors: ["Susanna Clarke"],
    year: "2021",
    publisher: "Bloomsbury",
    series: null,
  }),
];

/** The library book a record is another edition of, by the word its title starts with. */
const SAME_WORK: Record<string, ReturnType<typeof aScanBook>> = {
  Dracula: aScanBook({
    uuid: "uuid-dracula",
    title: "Dracula",
    authors: ["Bram Stoker"],
    has_files: false,
    has_physical: true,
  }),
  Dune: aScanBook({
    uuid: "uuid-dune",
    title: "Dune",
    authors: ["Frank Herbert"],
    has_files: true,
  }),
  Piranesi: aScanBook({
    uuid: "uuid-piranesi",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    has_files: false,
    has_physical: true,
  }),
};

/** Ada's pick to make on Piranesi, and a search already going for Dune. */
const GOING = [
  aWireRequest({
    id: 3,
    user_id: 1,
    book_uuid: "uuid-piranesi",
    state: "choose",
    versions: [aWireVersion({ id: 11 })],
  }),
  aWireRequest({ id: 4, user_id: 1, book_uuid: "uuid-dune" }),
];

let fake: RequestFake = requestFake();
let wishlistWrites = 0;

const libraryHandlers = [
  http.get("/api/ebooks/:uuid", ({ params }) => {
    const book =
      BOOKS.find((b) => b.unique_identifier === params.uuid) ??
      // The book a request made from a record has just created.
      aWireBook({
        title: "Jonathan Strange & Mr Norrell",
        unique_identifier: String(params.uuid),
        formats: [],
      });
    return HttpResponse.json(book);
  }),
  http.get("/api/search/palette", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const books = LIBRARY.filter((b) => b.title.toLowerCase().includes(q));
    return HttpResponse.json(aWirePalette({ books }));
  }),
  http.post("/api/scan/search", () => HttpResponse.json({ results: RECORDS })),
  http.post("/api/scan/resolve-meta", async ({ request }) => {
    const { meta } = ResolveMetaRequest.parse(await request.json());
    const book = SAME_WORK[meta.title.split(" ")[0] ?? ""];
    return HttpResponse.json(
      book
        ? { kind: "close_match", book, scanned: meta }
        : { kind: "not_in_library", online: meta },
    );
  }),
  http.post("/api/scan/resolve", () =>
    HttpResponse.json({
      kind: "close_match",
      book: SAME_WORK.Piranesi,
      scanned: RECORDS[3],
    }),
  ),
  http.post("/api/scan/wishlist", async () => {
    wishlistWrites += 1;
    return HttpResponse.json({ book_uuid: "never" });
  }),
  http.get("/api/wishlists", () => HttpResponse.json([])),
];

function Where() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="where">
      {pathname}
      {search}
    </output>
  );
}

function Page() {
  return (
    <>
      <Routes>
        <Route path="/requests" element={<Requests />} />
        <Route path="/books/:uuid/request" element={<BookRequest />} />
      </Routes>
      <Where />
    </>
  );
}

const meta = {
  title: "Pages/Requests/Add",
  component: Page,
  parameters: { path: "/requests", user: READER },
  beforeEach({ msw }) {
    wishlistWrites = 0;
    fake = requestFake(GOING, { books: BOOKS });
    msw.use(...libraryHandlers, ...fake.handlers);
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

/** Opens the search from the page's header and types `text` into it. */
async function search(
  canvas: Canvas,
  userEvent: {
    click: (e: Element) => Promise<void>;
    type: (e: Element, text: string) => Promise<void>;
  },
  text: string,
) {
  await userEvent.click(await canvas.findByTestId("requests-add"));
  const panel = within(await canvas.findByTestId("requests-add-panel"));
  await userEvent.type(panel.getByTestId("requests-add-search"), text);
  return panel;
}

export const RequestingABookStartsItAndSelectsIt: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("requests-add");
    await expect(button).toHaveAccessibleName("Request a book");
    await expect(button).toHaveTextContent("Request");
    const panel = await search(canvas, userEvent, "dracula");

    await userEvent.click(
      await panel.findByRole("button", { name: "Request Dracula" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-dracula",
      ),
    );
    await expect(canvas.queryByTestId("requests-add-panel")).toBeNull();
    await expect(fake.writes).toEqual([
      { kind: "start", uuid: "uuid-dracula" },
    ]);
    await expect(
      await canvas.findByRole("link", { name: /Dracula/, current: true }),
    ).toBeInTheDocument();
  },
};

export const ARequestedBookSaysSoAndOpensWithoutAWrite: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "piranesi");

    const open = await panel.findByRole("button", { name: "Open Piranesi" });
    await expect(panel.getByTestId("requests-add-result")).toHaveTextContent(
      "Susanna Clarke · 2020 · requested, choose a version",
    );
    await userEvent.click(open);

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-piranesi",
      ),
    );
    await expect(canvas.queryByTestId("requests-add-panel")).toBeNull();
    await expect(fake.writes).toEqual([]);
  },
};

export const ABookWithItsEbookOffersNothing: Story = {
  beforeEach({ msw }) {
    // Dune's search has ended, so it is not requested; the library still holds its ebook.
    fake = requestFake([], { books: BOOKS });
    msw.use(...fake.handlers);
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "dune");

    const result = await panel.findByTestId("requests-add-result");

    await expect(result).toHaveTextContent(
      "Frank Herbert · 1965 · in the library",
    );
    await expect(within(result).queryByRole("button")).toBeNull();
  },
};

export const AReaderWhoCantRequestSeesNoButton: Story = {
  parameters: { user: { ...READER, can_request: false } },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("requests-item");

    await expect(canvas.queryByTestId("requests-add")).toBeNull();
    await expect(canvas.queryByTestId("requests-add-wait")).toBeNull();
  },
};

export const TheButtonHoldsItsPlaceWhileTheListsLoad: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/requests"));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("requests-add-wait");

    await expect(canvas.queryByTestId("requests-add")).toBeNull();
  },
};

export const AFailedStartSaysWhyAndKeepsTheSearchOpen: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/books/:uuid/requests", 429));
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "dracula");

    await userEvent.click(
      await panel.findByRole("button", { name: "Request Dracula" }),
    );

    await waitFor(() =>
      expect(document.querySelector(".toast")).toHaveTextContent(
        "You have a lot of requests going. Try again in a few minutes.",
      ),
    );
    await expect(canvas.getByTestId("requests-add-panel")).toBeInTheDocument();
    await expect(
      panel.getByRole("button", { name: "Request Dracula" }),
    ).toBeEnabled();
  },
};

/** The provider section's result for `title`, and its Request button. */
async function recordFor(panel: Canvas, title: string) {
  const online = within(await panel.findByTestId("requests-add-online"));
  const result = await online.findByRole("button", {
    name: `Request ${title}`,
  });
  return { online, result };
}

export const ARecordTheLibraryLacksBecomesABookAndItsRequest: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "clarke");
    const { online, result } = await recordFor(
      panel,
      "Jonathan Strange & Mr Norrell",
    );
    await expect(
      online.getAllByTestId("requests-add-result")[0],
    ).toHaveTextContent("Susanna Clarke · Bloomsbury · 2004");

    await userEvent.click(result);

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        /\/requests\?book=uuid-new-/,
      ),
    );
    await expect(fake.writes).toEqual([
      { kind: "startFromMeta", title: "Jonathan Strange & Mr Norrell" },
    ]);
    await expect(wishlistWrites).toBe(0);
    await expect(
      await canvas.findByRole("link", {
        name: /Jonathan Strange & Mr Norrell/,
        current: true,
      }),
    ).toBeInTheDocument();
  },
};

export const ARecordOfALibraryBookStartsOnThatBook: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "dracula");
    const { result } = await recordFor(panel, "Dracula (Penguin Classics)");

    await userEvent.click(result);

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-dracula",
      ),
    );
    await expect(fake.writes).toEqual([
      { kind: "start", uuid: "uuid-dracula" },
    ]);
    await expect(wishlistWrites).toBe(0);
  },
};

export const ARecordOfABookWithARequestGoingSelectsItWithoutAWrite: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "piranesi");
    const { result } = await recordFor(panel, "Piranesi (Bloomsbury)");

    await userEvent.click(result);

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-piranesi",
      ),
    );
    await expect(fake.writes).toEqual([]);
  },
};

export const ARecordOfABookWithItsEbookSaysSoAndStaysOpen: Story = {
  beforeEach({ msw }) {
    // Dune's search has ended, so only its ebook is in the way.
    fake = requestFake([], { books: BOOKS });
    msw.use(...fake.handlers);
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "dune");
    const { result } = await recordFor(panel, "Dune (Ace)");

    await userEvent.click(result);

    await expect(await panel.findByRole("alert")).toHaveTextContent(
      "Dune (Ace) is already in the library.",
    );
    await expect(canvas.getByTestId("requests-add-panel")).toBeInTheDocument();
    await expect(fake.writes).toEqual([]);
  },
};

export const AnIsbnLookupsRecordTakesTheMatchedBooksOffer: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "9781635575637");

    const online = within(await panel.findByTestId("requests-add-online"));

    await expect(
      await online.findByRole("button", { name: "Open Piranesi" }),
    ).toBeInTheDocument();
    await expect(online.queryByRole("button", { name: /^Request/ })).toBeNull();
    await expect(fake.writes).toEqual([]);
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

export const OnAPhoneThePlusOpensASheetWithItsScanButton: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/requests", user: READER },
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("requests-add");
    await expect(button).toHaveAccessibleName("Request a book");
    await expect(within(button).getByText("Request")).not.toBeVisible();

    await userEvent.click(button);

    const sheet = within(await canvas.findByTestId("requests-add-panel"));
    await expect(
      await canvas.findByRole("dialog", { name: "Request a book" }),
    ).toHaveAttribute("aria-modal", "true");
    await expect(
      sheet.getByText(
        "Title, author or ISBN. The scan button reads the barcode on the back cover. Starts an ebook request.",
      ),
    ).toBeInTheDocument();
    await expect(sheet.getByTestId("requests-add-scan")).toHaveAccessibleName(
      "Scan a barcode",
    );
  },
};

export const OnADesktopTheSearchHasNoScanButton: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("requests-add"));

    await canvas.findByTestId("requests-add-panel");

    await expect(canvas.queryByTestId("requests-add-scan")).toBeNull();
  },
};

export const AScannedIsbnFillsTheFieldAndHidesTheScanner: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/requests", user: READER },
  beforeEach: () =>
    fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.("9781635575637");
    }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("requests-add"));
    const sheet = within(await canvas.findByTestId("requests-add-panel"));

    await userEvent.click(sheet.getByTestId("requests-add-scan"));

    await waitFor(() =>
      expect(sheet.getByTestId("requests-add-search")).toHaveValue(
        "9781635575637",
      ),
    );
    await expect(sheet.queryByTestId("barcode-scanner")).toBeNull();
    // The scanned ISBN takes the lookup, which found the library's Piranesi.
    await expect(
      await within(await sheet.findByTestId("requests-add-library")).findByRole(
        "button",
        { name: "Open Piranesi" },
      ),
    ).toBeInTheDocument();
  },
};

export const TheScannersWayOutToTypingHidesIt: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/requests", user: READER },
  beforeEach: () => fakeCamera(ready),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("requests-add"));
    const sheet = within(await canvas.findByTestId("requests-add-panel"));
    await userEvent.click(sheet.getByTestId("requests-add-scan"));
    await sheet.findByTestId("barcode-scanner");

    await userEvent.click(sheet.getByTestId("barcode-scanner-manual"));

    await expect(sheet.queryByTestId("barcode-scanner")).toBeNull();
  },
};
