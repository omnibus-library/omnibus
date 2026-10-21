import { HttpResponse, http } from "msw";
import {
  AddPhysicalOnlyRequest,
  CheckInRequest,
  type ExternalBookMeta,
  ResolveMetaRequest,
  ResolveRequest,
  type ScanBook,
  type ScanOutcome,
  ScanSearchRequest,
  WishlistAddRequest,
} from "../api/generated/schemas";

// MSW fakes and fixtures for the check-in flow.

/** A book the library holds, as an ISBN lookup matched it. */
export function aScanBook(overrides: Partial<ScanBook> = {}): ScanBook {
  return {
    uuid: "5b1c3c52-1d9e-4f5c-8a4e-0b6a2f7d9e11",
    title: "The Salt Road",
    authors: ["Mara Okafor", "Jun Aoki"],
    cover_url: null,
    has_physical: false,
    has_files: true,
    isbn: null,
    ...overrides,
  };
}

/** A provider's record of a book, as a lookup or a title search returns it. */
export function anExternalBook(
  overrides: Partial<ExternalBookMeta> = {},
): ExternalBookMeta {
  return {
    isbn13: "9780134685991",
    title: "Harbour Lights",
    authors: ["Ines Varga"],
    source: "open_library",
    year: "2021",
    series: "Tidewater (2)",
    publisher: "Lantern Press",
    pages: 320,
    first_publish_year: 2019,
    cover_url: null,
    ...overrides,
  };
}

/** The uuid a book created by "I own it" or a wishlist add comes back with. */
export const NEW_BOOK_UUID = "a7d94e6e-3f0b-4b57-9f4c-6f2d51c0b8aa";

type Refusals = Partial<
  Record<
    "resolve" | "resolveMeta" | "checkIn" | "physicalOnly" | "wishlist",
    string
  >
>;

/**
 * The check-in flow's routes: `POST /api/scan/resolve` and `.../resolve-meta` answer
 * `outcome`, `.../search` answers `found`, and the three writes answer with a book's
 * uuid. Each request body lands in its list (`searched` holds the queries); a
 * route named in `refuse` answers 400 with that plain text; `gate` holds the
 * resolve answer until it resolves.
 */
export function scanHandlers(
  outcome: ScanOutcome,
  {
    resolved = [],
    resolvedMeta = [],
    searched = [],
    found = [],
    checkedIn = [],
    physicalOnly = [],
    wishlisted = [],
    refuse = {},
    gate,
  }: {
    resolved?: string[];
    resolvedMeta?: ExternalBookMeta[];
    searched?: string[];
    found?: ExternalBookMeta[];
    checkedIn?: CheckInRequest[];
    physicalOnly?: AddPhysicalOnlyRequest[];
    wishlisted?: WishlistAddRequest[];
    refuse?: Refusals;
    gate?: Promise<void>;
  } = {},
) {
  const refused = (key: keyof Refusals) =>
    refuse[key] === undefined
      ? null
      : new HttpResponse(refuse[key], { status: 400 });
  return [
    http.post("/api/scan/resolve", async ({ request }) => {
      resolved.push(ResolveRequest.parse(await request.json()).isbn);
      await gate;
      return refused("resolve") ?? HttpResponse.json(outcome);
    }),
    http.post("/api/scan/resolve-meta", async ({ request }) => {
      resolvedMeta.push(ResolveMetaRequest.parse(await request.json()).meta);
      return refused("resolveMeta") ?? HttpResponse.json(outcome);
    }),
    http.post("/api/scan/search", async ({ request }) => {
      searched.push(ScanSearchRequest.parse(await request.json()).query);
      return HttpResponse.json({ results: found });
    }),
    http.post("/api/scan/check-in", async ({ request }) => {
      const body = CheckInRequest.parse(await request.json());
      checkedIn.push(body);
      return (
        refused("checkIn") ?? HttpResponse.json({ book_uuid: body.book_uuid })
      );
    }),
    http.post("/api/scan/physical-only", async ({ request }) => {
      physicalOnly.push(AddPhysicalOnlyRequest.parse(await request.json()));
      return (
        refused("physicalOnly") ??
        HttpResponse.json({ book_uuid: NEW_BOOK_UUID })
      );
    }),
    http.post("/api/scan/wishlist", async ({ request }) => {
      wishlisted.push(WishlistAddRequest.parse(await request.json()));
      return (
        refused("wishlist") ?? HttpResponse.json({ book_uuid: NEW_BOOK_UUID })
      );
    }),
  ];
}

/** `GET /api/scan/google-books-configured`: the bare JSON boolean the server sends. */
export const googleBooksHandler = (configured: boolean) =>
  http.get("/api/scan/google-books-configured", () =>
    HttpResponse.json(configured),
  );
