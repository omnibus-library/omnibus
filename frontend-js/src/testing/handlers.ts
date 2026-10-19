import { delay, HttpResponse, http } from "msw";
import type { FilterClause, FilterField } from "../api";
import {
  getGetAlignmentMockHandler200,
  getGetAuthorByIdMockHandler200,
  getGetAuthorReadingMockHandler200,
  getGetAuthorsMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetGenresMockHandler200,
  getGetHighlightsMockHandler200,
  getGetJournalEntriesMockHandler200,
  getGetMeMockHandler200,
  getGetMeMockHandler401,
  getGetOtherRatingsMockHandler200,
  getGetProgressMockHandler200,
  getGetRatingMockHandler200,
  getGetReadStatusMockHandler200,
  getGetRegistrationMockHandler200,
  getGetSeriesByIdMockHandler200,
  getGetSessionLogMockHandler200,
  getGetSuggestionsMockHandler200,
  getGetTagsMockHandler200,
  getGetWishlistEntryMockHandler200,
  getListPhysicalCopiesMockHandler200,
  getListSeriesMockHandler200,
  getListShelvesMockHandler200,
  getShelvesContainingMockHandler200,
  getSmartShelvesContainingMockHandler200,
} from "../api/generated/omnibus.msw";
import {
  AddShelfBooksBody,
  type AlignmentView,
  type AuthorReading,
  type AuthorSummary,
  type BookDeletionManifest,
  BulkOverridesRequest,
  CreateShelfRequest,
  DeleteBookFilesRequest,
  type EbookMetadata,
  type EbookPage,
  type GenreWeight,
  type Highlight,
  type JournalEntry,
  KindleSendRequest,
  type LoginResponse,
  MergeBooksRequest,
  type PaletteResults,
  type PhysicalCopy,
  PostCrossFormatFollowBody,
  PostJournalBody,
  PostJournalPreviewBody,
  PostRatingBody,
  PutAuthorPhotoUrlBody,
  PutReadStatusBody,
  type RatingRecord,
  type ReadStatusRecord,
  type ResumePoint,
  type RulePreview,
  RulePreviewRequest,
  type SeriesDetail,
  type SeriesStack,
  type SeriesSummary,
  type SessionLogEntry,
  SetStackSeries,
  type Shelf,
  type ShelfSummary,
  type TagWeight,
  UndoMergeRequest,
  UpdateCopyNoteRequest,
  UpdateJournalEntry,
  UpdateShelfRequest,
  type WishlistEntry,
} from "../api/generated/schemas";
import { sameName } from "../components/FilterBar/filters";
import { nowSecs } from "../format";
import { COVER_SVG } from "./books";
import {
  aWireAlignment,
  aWireAuthor,
  aWireJournalEntry,
  aWireProgress,
  aWireReadStatus,
  aWireSeries,
  aWireShelfDetail,
  aWireWishlist,
  WIRE_ADA,
} from "./wire";

// The MSW fake of the `/api/*` routes the client calls. orval generates a
// handler per documented status (`../api/generated/omnibus.msw`); the ones here
// need behaviour a generated handler can't express, such as paging headers or
// checking the request, and their bodies are typed by the generated schemas.

export const svg = () =>
  new HttpResponse(COVER_SVG, { headers: { "Content-Type": "image/svg+xml" } });

/** A held request: pass `promise` to a handler's gate, call `release` from the story when the answer may land. */
export function deferred() {
  let release = () => {};
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

/** Every cover and thumbnail answers with the sample cover. */
export const coverHandlers = [
  http.get("/api/thumbs/:uuid/:size", svg),
  http.get("/api/covers/:uuid", svg),
];

/** The session `GET /api/auth/me` reports; `null` answers as a guest. */
export function sessionHandler(user: typeof WIRE_ADA | null = WIRE_ADA) {
  return user ? getGetMeMockHandler200(user) : getGetMeMockHandler401();
}

/** The library path the fixture server reports on page 1. */
export const LIBRARY_PATH = "/library";

// What a book carries under a filter field; shelf membership isn't on the book.
function carried(book: EbookMetadata, field: FilterField): string[] {
  switch (field) {
    case "tag":
      return book.subjects;
    case "genre":
      return book.genres ?? [];
    case "author":
      return book.creators.map((c) => c.name);
    case "series":
      return book.series ? [book.series] : [];
    case "format":
      return book.formats ?? [];
    case "shelf":
      return [];
  }
}

/** Whether `book` passes every clause, as the server decides: any value matches, exclude inverts. */
function passes(book: EbookMetadata, clauses: FilterClause[]): boolean {
  return clauses
    .filter((c) => c.field !== "shelf")
    .every((c) => {
      const held = carried(book, c.field);
      const hit = c.values.some((v) => held.some((h) => sameName(h, v)));
      return c.mode === "include" ? hit : !hit;
    });
}

/**
 * Library pages of `pageSize` in fixture order, narrowed by `filter` and
 * `exclude_formats` as the server does, with its paging headers. Each
 * request's search params land in `requests`, for assertions. A request with
 * `stack_series` gets `stacks` folded into their leads' slots.
 */
export function libraryHandler(
  books: EbookMetadata[],
  pageSize = 3,
  {
    path = LIBRARY_PATH,
    requests = [],
    stacks = [],
  }: {
    path?: string | null;
    requests?: URLSearchParams[];
    stacks?: SeriesStack[];
  } = {},
) {
  return http.get("/api/ebooks", ({ request }) => {
    const url = new URL(request.url);
    requests.push(url.searchParams);
    // The API refuses a cursor unless sort and dir are both explicit.
    if (
      url.searchParams.has("cursor") &&
      !(url.searchParams.has("sort") && url.searchParams.has("dir"))
    ) {
      return new HttpResponse("cursor without sort and dir", { status: 400 });
    }
    const clauses: FilterClause[] = JSON.parse(
      url.searchParams.get("filter") ?? "[]",
    );
    const exclude = (url.searchParams.get("exclude_formats") ?? "")
      .split(",")
      .filter(Boolean);
    const narrowed = books.filter((b) => passes(b, clauses));
    const shown = narrowed.filter(
      (b) =>
        !(b.formats ?? []).some((f) => exclude.some((x) => sameName(f, x))),
    );
    const folding = url.searchParams.get("stack_series") === "true";
    const members = new Set(
      stacks.flatMap((s) => s.members.map((m) => m.unique_identifier)),
    );
    const leads = new Set(stacks.map((s) => s.lead_uuid));
    // A stack takes its lead's slot, so the other members leave the list.
    const listed = folding
      ? shown.filter(
          (b) =>
            !members.has(b.unique_identifier) ||
            leads.has(b.unique_identifier ?? ""),
        )
      : shown;
    const start = Number(url.searchParams.get("cursor") ?? "0");
    const end = start + pageSize;
    const headers: Record<string, string> = {
      "X-Total-Count": String(listed.length),
    };
    if (end < listed.length) headers["X-Next-Cursor"] = String(end);
    if (exclude.length) {
      headers["X-Hidden-Count"] = String(narrowed.length - shown.length);
    }
    const page = {
      books: listed.slice(start, end),
      path,
      ...(folding && { stacks }),
    } satisfies EbookPage;
    return HttpResponse.json(page, { headers });
  });
}

/**
 * `POST /api/account/stack-series` and a `GET /api/auth/me` that reports what
 * it saved, so the refetch after a save agrees with it. Each request body lands
 * in `bodies`; `gate` holds the save until it resolves.
 */
export function stackSeriesHandler({
  bodies = [],
  gate = Promise.resolve(),
}: {
  bodies?: unknown[];
  gate?: Promise<void>;
} = {}) {
  let enabled = WIRE_ADA.stack_series ?? false;
  return [
    getGetMeMockHandler200(() => ({ ...WIRE_ADA, stack_series: enabled })),
    http.post("/api/account/stack-series", async ({ request }) => {
      const body = SetStackSeries.parse(await request.json());
      bodies.push(body);
      await gate;
      enabled = body.enabled;
      return new HttpResponse(null);
    }),
  ];
}

/** `GET /api/shelves`. */
export function shelvesHandler(shelves: ShelfSummary[]) {
  return getListShelvesMockHandler200(shelves);
}

/**
 * `GET /api/shelves/{id}/page`: the shelf's `books` in fixture order, narrowed
 * by `filter` as the server does; an id with no shelf is a 404. Each request's
 * search params land in `requests`.
 */
export function shelfPageHandler(
  shelves: Record<number, EbookMetadata[]>,
  { requests = [] }: { requests?: URLSearchParams[] } = {},
) {
  return http.get("/api/shelves/:id/page", ({ params, request }) => {
    const members = shelves[Number(params.id)];
    if (!members) return new HttpResponse("shelf not found", { status: 404 });
    const search = new URL(request.url).searchParams;
    requests.push(search);
    const clauses: FilterClause[] = JSON.parse(search.get("filter") ?? "[]");
    return HttpResponse.json({
      books: members.filter((b) => passes(b, clauses)),
    });
  });
}

/**
 * `POST /api/ebooks/overrides/bulk`: applies the edit to the matching books of
 * `books` in place, as the server does, so a refetch sees it, and answers 204.
 * Each request lands in `saved`; with `refuse` set, a 400 whose plain text is
 * that reason and nothing changes.
 */
export function bulkOverridesHandler(
  books: EbookMetadata[],
  {
    saved = [],
    refuse,
  }: { saved?: BulkOverridesRequest[]; refuse?: string } = {},
) {
  return http.post("/api/ebooks/overrides/bulk", async ({ request }) => {
    if (refuse) return new HttpResponse(refuse, { status: 400 });
    const body = BulkOverridesRequest.parse(await request.json());
    saved.push(body);
    const { edit } = body;
    // Removals first, then each addition the list lacks, order kept.
    const merge = (
      current: string[],
      remove: string[] = [],
      add: string[] = [],
    ) => {
      const kept = current.filter((v) => !remove.includes(v));
      return [...kept, ...add.filter((v) => !kept.includes(v))];
    };
    for (const book of books) {
      if (!body.uuids.includes(book.unique_identifier ?? "")) continue;
      if (edit.authors) book.creators = edit.authors.map((name) => ({ name }));
      if (edit.series != null) book.series = edit.series;
      if (edit.publisher != null) book.publisher = edit.publisher;
      if (edit.language != null) book.language = edit.language;
      book.subjects = merge(book.subjects, edit.remove_tags, edit.add_tags);
      book.genres = merge(
        book.genres ?? [],
        edit.remove_genres,
        edit.add_genres,
      );
    }
    return new HttpResponse(null, { status: 204 });
  });
}

/**
 * `POST /api/shelves/{id}/books`: a 204 for any shelf. Each request lands in
 * `added`; with `refuse` set, a 403 whose plain text is that reason.
 */
export function addShelfBooksHandler({
  added = [],
  refuse,
  gate,
}: {
  added?: { id: number; uuids: string[] }[];
  refuse?: string;
  /** Held until it settles, so a story can act while the save is in flight. */
  gate?: Promise<void>;
} = {}) {
  return http.post("/api/shelves/:id/books", async ({ params, request }) => {
    await gate;
    if (refuse) return new HttpResponse(refuse, { status: 403 });
    const body = AddShelfBooksBody.parse(await request.json());
    added.push({ id: Number(params.id), uuids: body.book_uuids });
    return new HttpResponse(null, { status: 204 });
  });
}

/** `GET /api/authors` and the reader's `GET /api/authors/reading`. */
export function authorsHandlers({
  authors,
  reading = [],
}: {
  authors: AuthorSummary[];
  reading?: AuthorReading[];
}) {
  return [
    getGetAuthorsMockHandler200(authors),
    getGetAuthorReadingMockHandler200(reading),
  ];
}

/** `GET /api/series` and `GET /api/series/{id}`. */
export function seriesHandlers({
  list = [],
  detail,
}: {
  list?: SeriesSummary[];
  detail?: SeriesDetail;
}) {
  return [
    getListSeriesMockHandler200(list),
    ...(detail ? [getGetSeriesByIdMockHandler200(detail)] : []),
  ];
}

/** One write a shelf page made, in the order it made them. */
export type ShelfWrite =
  | { op: "add"; uuids: string[] }
  | { op: "remove"; uuid: string }
  | { op: "patch"; body: UpdateShelfRequest }
  | { op: "delete" };

/**
 * One shelf and its members, kept between reads and writes: `GET` the shelf and its
 * page (narrowed by `filter`, each request's params landing in `requests`), `POST`
 * books from `pool` onto it, `DELETE` one off, `PATCH` fields over it, `DELETE` the
 * shelf (after which it is a 404). Each write lands in `writes`.
 */
export function shelfDetailHandlers(
  shelf: Shelf,
  members: EbookMetadata[],
  writes: ShelfWrite[] = [],
  {
    pool = [],
    requests = [],
  }: { pool?: EbookMetadata[]; requests?: URLSearchParams[] } = {},
) {
  let current: Shelf | null = shelf;
  let held = members;
  const gone = () => new HttpResponse("shelf not found", { status: 404 });
  return [
    http.get("/api/shelves/:id", () =>
      current
        ? HttpResponse.json({ ...current, book_count: held.length })
        : gone(),
    ),
    http.get("/api/shelves/:id/page", ({ request }) => {
      if (!current) return gone();
      const search = new URL(request.url).searchParams;
      requests.push(search);
      const clauses: FilterClause[] = JSON.parse(search.get("filter") ?? "[]");
      return HttpResponse.json({
        books: held.filter((b) => passes(b, clauses)),
      });
    }),
    http.post("/api/shelves/:id/books", async ({ request }) => {
      const { book_uuids } = AddShelfBooksBody.parse(await request.json());
      writes.push({ op: "add", uuids: book_uuids });
      held = [
        ...held,
        ...pool.filter((b) => book_uuids.includes(b.unique_identifier ?? "")),
      ];
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/shelves/:id/books/:uuid", ({ params }) => {
      writes.push({ op: "remove", uuid: String(params.uuid) });
      held = held.filter((b) => b.unique_identifier !== params.uuid);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch("/api/shelves/:id", async ({ request }) => {
      const body = UpdateShelfRequest.parse(await request.json());
      writes.push({ op: "patch", body });
      if (!current) return gone();
      const { sync_to_kobo, name, visibility, rules, match_mode, description } =
        body;
      current = {
        ...current,
        ...(name != null && { name }),
        ...(visibility != null && { visibility }),
        ...(rules != null && { rules }),
        ...(match_mode != null && { match_mode }),
        ...(description !== undefined && { description }),
        ...(sync_to_kobo != null && { sync_to_kobo }),
      };
      return HttpResponse.json({ ...current, book_count: held.length });
    }),
    http.delete("/api/shelves/:id", () => {
      writes.push({ op: "delete" });
      current = null;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/**
 * `POST /api/shelves/preview`: each request body lands in `bodies`, and the answer is
 * `answer`, or what it returns for that body.
 */
export function previewHandler(
  bodies: RulePreviewRequest[],
  answer: RulePreview | ((body: RulePreviewRequest) => Promise<RulePreview>),
) {
  return http.post("/api/shelves/preview", async ({ request }) => {
    const body = RulePreviewRequest.parse(await request.json());
    bodies.push(body);
    return HttpResponse.json(
      typeof answer === "function" ? await answer(body) : answer,
    );
  });
}

/**
 * `POST /api/shelves`: each body lands in `bodies`; the answer is `created` as a 201, or with
 * `refuse` set a 409 whose plain text is that reason.
 */
export function createShelfHandler(
  bodies: CreateShelfRequest[],
  {
    created = aWireShelfDetail({ id: 9, name: "Cosy reads" }),
    refuse,
  }: { created?: Shelf; refuse?: string } = {},
) {
  return http.post("/api/shelves", async ({ request }) => {
    bodies.push(CreateShelfRequest.parse(await request.json()));
    return refuse
      ? new HttpResponse(refuse, { status: 409 })
      : HttpResponse.json(created, { status: 201 });
  });
}

/** `GET /api/search`: `books` as the hits, `total` (their count by default) in `X-Total-Count`. */
export function searchHandler(books: EbookMetadata[], total = books.length) {
  return http.get("/api/search", () =>
    HttpResponse.json(
      { books },
      { headers: { "X-Total-Count": String(total) } },
    ),
  );
}

/**
 * An author's photo (the sample image) and the admin's writes: `PUT .../photo/url` and
 * `PUT .../photo` answer 204 and append `url:<url>` or `upload:<file name>` to `writes`;
 * the scan answers `scanFound`.
 */
export function authorPhotoHandlers(writes: string[] = [], scanFound = true) {
  return [
    http.get("/api/authors/:id/photo", svg),
    http.put("/api/authors/:id/photo/url", async ({ request }) => {
      const { url } = PutAuthorPhotoUrlBody.parse(await request.json());
      writes.push(`url:${url}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.put("/api/authors/:id/photo", async ({ request }) => {
      const file = (await request.formData()).get("photo");
      writes.push(`upload:${file instanceof File ? file.name : "missing"}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("/api/authors/:id/photo/scan", () =>
      HttpResponse.json({ resolved: scanFound }),
    ),
  ];
}

/** The four lists the filter menus draw their values from. */
export function filterOptionHandlers({
  tags = [],
  genres = [],
  authors = [],
  series = [],
}: {
  tags?: TagWeight[];
  genres?: GenreWeight[];
  authors?: AuthorSummary[];
  series?: SeriesSummary[];
} = {}) {
  return [
    getGetTagsMockHandler200(tags),
    getGetGenresMockHandler200(genres),
    getGetAuthorsMockHandler200(authors),
    getListSeriesMockHandler200(series),
  ];
}

/** One book by uuid; any other uuid is a 404, as on the server. */
export function bookHandler(book: EbookMetadata) {
  return http.get("/api/ebooks/:uuid", ({ params }) =>
    params.uuid === book.unique_identifier
      ? HttpResponse.json(book)
      : new HttpResponse(null, { status: 404 }),
  );
}

/** Every GET the whole book page fires, answered quietly for `book`: its series holds three. */
export function bookDetailHandlers(book: EbookMetadata) {
  return [
    bookHandler(book),
    getGetSeriesByIdMockHandler200(aWireSeries()),
    getGetReadStatusMockHandler200(null),
    getGetProgressMockHandler200(aWireProgress()),
    getGetAlignmentMockHandler200(aWireAlignment()),
    getGetRatingMockHandler200(null),
    getGetOtherRatingsMockHandler200([]),
    getGetSessionLogMockHandler200({ entries: [] }),
    getGetHighlightsMockHandler200([]),
    getGetJournalEntriesMockHandler200([]),
    getListPhysicalCopiesMockHandler200([]),
    getGetWishlistEntryMockHandler200(null),
    getListShelvesMockHandler200([]),
    getShelvesContainingMockHandler200([]),
    getSmartShelvesContainingMockHandler200([]),
    getGetAuthorByIdMockHandler200(aWireAuthor()),
    getGetSuggestionsMockHandler200({ status: "ready", items: [] }),
    getGetBookInsightsMockHandler200(null),
  ];
}

/**
 * The reader's rating, kept between `GET`, `POST` and `DELETE`, starting at
 * `initial`; each write appends its stars (`null` for a delete) to `writes`.
 */
export function ratingHandlers(
  initial: RatingRecord | null,
  writes: (number | null)[] = [],
) {
  let current = initial;
  return [
    http.get("/api/ratings/:uuid", () => HttpResponse.json(current)),
    http.post("/api/ratings", async ({ request }) => {
      const body = PostRatingBody.parse(await request.json());
      writes.push(body.stars);
      current = { ...body, updated_at: nowSecs() };
      return HttpResponse.json(current);
    }),
    http.delete("/api/ratings/:uuid", () => {
      writes.push(null);
      current = null;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/** The passages `GET` lists and `DELETE` removes, starting at `initial`; each deleted id lands in `deleted`. */
export function highlightsHandlers(
  initial: Highlight[],
  deleted: number[] = [],
) {
  let current = initial;
  return [
    http.get("/api/highlights/book/:uuid", () => HttpResponse.json(current)),
    http.delete("/api/highlights/:id", ({ params }) => {
      const id = Number(params.id);
      deleted.push(id);
      current = current.filter((h) => h.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/**
 * The journal feed as the server serves it to `viewerId`: everyone's published entries and
 * the viewer's own drafts, never another reader's. `POST` creates the viewer's entry (ids
 * count up from 100), `PATCH` rewrites it and may publish it, `DELETE` removes it, and the
 * preview answers the markdown in a `<p>`; each write records the entry id and status in `writes`.
 */
export function journalHandlers(
  all: JournalEntry[],
  viewerId: number,
  writes: { id: number; status?: string }[] = [],
) {
  let current = all;
  let nextId = 100;
  const html = (md: string) => `<p>${md}</p>`;
  return [
    http.get("/api/journals/book/:uuid", () =>
      HttpResponse.json(
        current.filter((e) => e.status !== "draft" || e.author_id === viewerId),
      ),
    ),
    http.post("/api/journals", async ({ request }) => {
      const body = PostJournalBody.parse(await request.json());
      const entry = aWireJournalEntry({
        id: nextId++,
        author_id: viewerId,
        body_md: body.body_md,
        body_html: html(body.body_md),
        progress: body.progress,
        status: body.status ?? "published",
      });
      writes.push({ id: entry.id, status: body.status });
      current = [...current, entry];
      return HttpResponse.json(entry);
    }),
    http.post("/api/journals/preview", async ({ request }) =>
      HttpResponse.json(
        html(PostJournalPreviewBody.parse(await request.json())),
      ),
    ),
    http.patch("/api/journals/:id", async ({ params, request }) => {
      const id = Number(params.id);
      const body = UpdateJournalEntry.parse(await request.json());
      writes.push({ id, status: body.status ?? undefined });
      current = current.map((e) =>
        e.id === id
          ? {
              ...e,
              body_md: body.body_md,
              body_html: html(body.body_md),
              status: body.status ?? e.status,
            }
          : e,
      );
      return HttpResponse.json(current.find((e) => e.id === id));
    }),
    http.delete("/api/journals/:id", ({ params }) => {
      const id = Number(params.id);
      writes.push({ id });
      current = current.filter((e) => e.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/**
 * The book's physical copies and the reader's wishlist entry, kept between reads and writes.
 * Each write appends a line to `writes`: `note:<id>:<text>`, `delete-copy:<id>`,
 * `delete-book`, `wishlist:add` or `wishlist:remove` (which also deletes the book when `removalDeletesBook`).
 */
export function physicalHandlers(
  initial: { copies?: PhysicalCopy[]; wishlist?: WishlistEntry | null },
  writes: string[] = [],
  removalDeletesBook = false,
) {
  let copies = initial.copies ?? [];
  let wishlist = initial.wishlist ?? null;
  return [
    http.get("/api/physical/:uuid/copies", () => HttpResponse.json(copies)),
    http.patch("/api/physical/copies/:id", async ({ params, request }) => {
      const id = Number(params.id);
      const { note } = UpdateCopyNoteRequest.parse(await request.json());
      writes.push(`note:${id}:${note ?? ""}`);
      copies = copies.map((c) => (c.id === id ? { ...c, note } : c));
      return HttpResponse.json(copies.find((c) => c.id === id));
    }),
    http.delete("/api/physical/copies/:id", ({ params }) => {
      writes.push(`delete-copy:${params.id}`);
      copies = copies.filter((c) => c.id !== Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/physical/:uuid", () => {
      writes.push("delete-book");
      return new HttpResponse(null, { status: 204 });
    }),
    http.get("/api/physical/:uuid/wishlist", () => HttpResponse.json(wishlist)),
    http.post("/api/physical/:uuid/wishlist", () => {
      writes.push("wishlist:add");
      wishlist = aWireWishlist();
      return HttpResponse.json(wishlist);
    }),
    http.delete("/api/physical/:uuid/wishlist", () => {
      writes.push("wishlist:remove");
      wishlist = null;
      return HttpResponse.json({ book_deleted: removalDeletesBook });
    }),
  ];
}

/**
 * The shelf list with the ids holding the book by hand and by rule, kept between reads and
 * writes. A hand-picked `POST`/`DELETE` appends `add:<shelf>` or `remove:<shelf>` to `writes`
 * and moves the book in or out; `failOn` is a shelf whose writes answer 500.
 */
export function shelvesHandlers(
  shelves: ShelfSummary[],
  held: { manual?: number[]; smart?: number[] } = {},
  writes: string[] = [],
  failOn?: number,
) {
  const initial = held.manual ?? [];
  let manual = initial;
  // A shelf's count follows the book in or out, as the server's would.
  const counted = (shelf: ShelfSummary) => ({
    ...shelf,
    book_count:
      shelf.book_count +
      Number(manual.includes(shelf.id)) -
      Number(initial.includes(shelf.id)),
  });
  const refused = () => new HttpResponse("failed with 500", { status: 500 });
  return [
    http.get("/api/shelves", () => HttpResponse.json(shelves.map(counted))),
    http.get("/api/shelves/containing/:uuid", () => HttpResponse.json(manual)),
    http.get("/api/shelves/containing/:uuid/smart", () =>
      HttpResponse.json(held.smart ?? []),
    ),
    http.post("/api/shelves/:id/books", ({ params }) => {
      const id = Number(params.id);
      if (id === failOn) return refused();
      writes.push(`add:${id}`);
      manual = [...manual, id];
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/shelves/:id/books/:uuid", ({ params }) => {
      const id = Number(params.id);
      if (id === failOn) return refused();
      writes.push(`remove:${id}`);
      manual = manual.filter((m) => m !== id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/**
 * Send to Kindle: `POST` queues task 7 and appends its body to `sent`; each `GET` of the
 * status answers the next of `answers` (the last repeats), counting itself in `polls.count`.
 * `"unknown"` answers 404, as a task the server has forgotten does.
 */
export function kindleHandlers(
  answers: (
    | "pending"
    | "sent"
    | "unknown"
    | { status: "failed"; message: string }
  )[],
  sent: { book_uuid: string; file_id?: number | null }[] = [],
  polls = { count: 0 },
) {
  return [
    http.post("/api/kindle/send", async ({ request }) => {
      sent.push(KindleSendRequest.parse(await request.json()));
      return HttpResponse.json({ task_id: 7 });
    }),
    http.get("/api/kindle/send/status", () => {
      const answer = answers[Math.min(polls.count++, answers.length - 1)];
      if (answer === "unknown") {
        return new HttpResponse("no such send", { status: 404 });
      }
      return HttpResponse.json(
        typeof answer === "string" ? { status: answer } : answer,
      );
    }),
  ];
}

/**
 * Merging: the candidates whose title holds the query, then `POST`s that record `merge:<source>><target>`
 * and `undo:<id>` in `writes` (merge log id 5, restoring `restored`). `refuse` answers the merge with that status.
 */
export function mergeHandlers(
  candidates: EbookMetadata[],
  writes: string[] = [],
  refuse?: number,
  restored = "00000000-0000-4000-8000-000000000002",
) {
  return [
    http.get("/api/books/merge/candidates", ({ request }) => {
      const q = (
        new URL(request.url).searchParams.get("q") ?? ""
      ).toLowerCase();
      return HttpResponse.json(
        candidates.filter((b) => b.title?.toLowerCase().includes(q)),
      );
    }),
    http.post("/api/books/merge", async ({ request }) => {
      if (refuse) {
        return new HttpResponse(`failed with ${refuse}`, { status: refuse });
      }
      const body = MergeBooksRequest.parse(await request.json());
      writes.push(`merge:${body.source_uuid}>${body.target_uuid}`);
      return HttpResponse.json({
        merge_log_id: 5,
        target_uuid: body.target_uuid,
      });
    }),
    http.post("/api/books/merge/undo", async ({ request }) => {
      const body = UndoMergeRequest.parse(await request.json());
      writes.push(`undo:${body.merge_log_id}`);
      return HttpResponse.json({ restored_uuid: restored });
    }),
  ];
}

/**
 * Deleting: the book's `manifest`, and a `POST` that records `delete:files=<ids>;copies=<ids>`
 * in `writes` and answers `bookDeleted`, taking a `delayMs` to do it.
 */
export function deletionHandlers(
  manifest: BookDeletionManifest,
  writes: string[] = [],
  bookDeleted = false,
  delayMs = 0,
) {
  return [
    http.get("/api/books/:uuid/deletion-manifest", () =>
      HttpResponse.json(manifest),
    ),
    http.post("/api/books/:uuid/delete-files", async ({ request }) => {
      const body = DeleteBookFilesRequest.parse(await request.json());
      writes.push(
        `delete:files=${(body.file_ids ?? []).join(",")};copies=${(body.copy_ids ?? []).join(",")}`,
      );
      await delay(delayMs);
      return HttpResponse.json({
        book_deleted: bookDeleted,
        deleted_file_ids: body.file_ids ?? [],
        deleted_copy_ids: body.copy_ids ?? [],
      });
    }),
  ];
}

/** `GET /api/stats/sessions` in pages of `pageSize`, the cursor being the offset of the next page. */
export function sessionLogHandler(entries: SessionLogEntry[], pageSize = 2) {
  return http.get("/api/stats/sessions", ({ request }) => {
    const start = Number(
      new URL(request.url).searchParams.get("before") ?? "0",
    );
    const end = start + pageSize;
    return HttpResponse.json({
      entries: entries.slice(start, end),
      next_before: end < entries.length ? String(end) : null,
    });
  });
}

/**
 * The read status `GET` and `PUT` keep between them, starting at `initial`;
 * a `PUT` answers the record it stored and appends its body to `writes`.
 * Each `GET` counts itself in `reads.count`.
 */
export function readStatusHandlers(
  initial: ReadStatusRecord | null,
  writes: { status: string }[] = [],
  reads = { count: 0 },
) {
  let current = initial;
  return [
    http.get("/api/read-status/:uuid", () => {
      reads.count++;
      return HttpResponse.json(current);
    }),
    http.put("/api/read-status", async ({ request }) => {
      const body = PutReadStatusBody.parse(await request.json());
      writes.push(body);
      current = aWireReadStatus({
        ...body,
        finished_at: body.status === "finished" ? nowSecs() : null,
      });
      return HttpResponse.json(current);
    }),
  ];
}

/**
 * The alignment `GET` serves `aligned`, its link's `follow` the last one `POST`ed to
 * `/api/books/:uuid/cross-format-follow` (answering `204` and appending the body to `writes`).
 * Each alignment read counts itself in `reads.count`.
 */
export function followHandlers(
  aligned: AlignmentView,
  writes: { enabled: boolean }[],
  reads = { count: 0 },
) {
  let follow = aligned.link?.follow;
  return [
    http.get("/api/books/:uuid/alignment", () => {
      reads.count++;
      return HttpResponse.json({
        ...aligned,
        link: aligned.link && { ...aligned.link, follow },
      });
    }),
    http.post("/api/books/:uuid/cross-format-follow", async ({ request }) => {
      const body = PostCrossFormatFollowBody.parse(await request.json());
      writes.push(body);
      follow = body.enabled;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/** `GET /api/progress/recent`, answering the first `limit` of `points`. */
export function recentProgressHandler(points: ResumePoint[]) {
  return http.get("/api/progress/recent", ({ request }) => {
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    if (!Number.isInteger(limit) || limit < 1) {
      return new HttpResponse("limit must be a positive integer", {
        status: 400,
      });
    }
    return HttpResponse.json(points.slice(0, limit));
  });
}

/**
 * `GET /api/search/palette` answering `preview` for any non-blank query, and
 * `full` when the client raises the per-group cap with `limit`.
 */
export function paletteHandler(
  preview: PaletteResults,
  full: PaletteResults | "fails" = preview,
) {
  return http.get("/api/search/palette", ({ request }) => {
    const params = new URL(request.url).searchParams;
    if (!params.get("q")?.trim()) {
      return new HttpResponse("q is required", { status: 400 });
    }
    const limit = params.get("limit");
    if (limit === null) return HttpResponse.json(preview);
    if (!/^[1-9]\d*$/.test(limit)) {
      return new HttpResponse("limit must be a positive integer", {
        status: 400,
      });
    }
    return full === "fails"
      ? new HttpResponse("failed with 500", { status: 500 })
      : HttpResponse.json(full);
  });
}

/** `GET /api/auth/registration`: whether self-registration is open. */
export function registrationHandler(enabled: boolean) {
  return getGetRegistrationMockHandler200({ enabled });
}

/** `POST /api/auth/register`, refusing `taken` as the server refuses a duplicate. */
export function registerHandler(taken = "taken") {
  return http.post("/api/auth/register", async ({ request }) => {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("username" in body) ||
      !("password" in body)
    ) {
      return new HttpResponse("missing credentials", { status: 422 });
    }
    return body.username === taken
      ? new HttpResponse("username already taken", { status: 409 })
      : HttpResponse.json({
          user: { ...WIRE_ADA, username: String(body.username) },
        } satisfies LoginResponse);
  });
}

/** `POST /api/auth/login` accepting `password` for any username. */
export function loginHandler(password: string) {
  return http.post("/api/auth/login", async ({ request }) => {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("password" in body)) {
      return new HttpResponse("missing credentials", { status: 422 });
    }
    return body.password === password
      ? HttpResponse.json({ user: WIRE_ADA } satisfies LoginResponse)
      : new HttpResponse("invalid credentials", { status: 401 });
  });
}

type Method = "get" | "post" | "put" | "patch" | "delete";

/** Answers `path` with `status` and a plain-text body, as an Axum error does. */
export function failing(method: Method, path: string, status: number) {
  return http[method](
    path,
    () => new HttpResponse(`failed with ${status}`, { status }),
  );
}

/** Never answers `path`, to hold a screen in its loading state. */
export function hanging(path: string, method: Method = "get") {
  return http[method](path, async () => {
    await delay("infinite");
    return new HttpResponse(null);
  });
}
