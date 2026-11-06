import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { failing, hanging } from "../../testing/handlers";
import {
  aWireRequest,
  aWireVersion,
  type RequestFake,
  requestFake,
} from "../../testing/requestHandlers";
import {
  aWireBook,
  aWirePalette,
  aWirePaletteBook,
  WIRE_ADA,
} from "../../testing/wire";
import { BookRequest } from "../BookRequest/BookRequest";
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

const libraryHandlers = [
  http.get("/api/ebooks/:uuid", ({ params }) => {
    const book = BOOKS.find((b) => b.unique_identifier === params.uuid);
    return book
      ? HttpResponse.json(book)
      : new HttpResponse(null, { status: 404 });
  }),
  http.get("/api/search/palette", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const books = LIBRARY.filter((b) => b.title.toLowerCase().includes(q));
    return HttpResponse.json(aWirePalette({ books }));
  }),
  http.post("/api/scan/search", () => HttpResponse.json({ results: [] })),
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
