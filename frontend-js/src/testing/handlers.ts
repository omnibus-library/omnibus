import { delay, HttpResponse, http } from "msw";
import {
  getGetAlignmentMockHandler200,
  getGetAuthorByIdMockHandler200,
  getGetBookInsightsMockHandler200,
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
  getGetWishlistEntryMockHandler200,
  getListPhysicalCopiesMockHandler200,
  getListShelvesMockHandler200,
  getShelvesContainingMockHandler200,
  getSmartShelvesContainingMockHandler200,
} from "../api/generated/omnibus.msw";
import {
  type BookDeletionManifest,
  DeleteBookFilesRequest,
  type EbookMetadata,
  type EbookPage,
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
  PutReadStatusBody,
  type RatingRecord,
  type ReadStatusRecord,
  type ResumePoint,
  type SessionLogEntry,
  type ShelfSummary,
  UndoMergeRequest,
  UpdateCopyNoteRequest,
  UpdateJournalEntry,
  type WishlistEntry,
} from "../api/generated/schemas";
import { COVER_SVG } from "./books";
import {
  aWireAlignment,
  aWireAuthor,
  aWireJournalEntry,
  aWireProgress,
  aWireReadStatus,
  aWireSeries,
  aWireWishlist,
  WIRE_ADA,
} from "./wire";

// The MSW fake of the `/api/*` routes the client calls. orval generates a
// handler per documented status (`../api/generated/omnibus.msw`); the ones here
// need behaviour a generated handler can't express, such as paging headers or
// checking the request, and their bodies are typed by the generated schemas.

const svg = () =>
  new HttpResponse(COVER_SVG, { headers: { "Content-Type": "image/svg+xml" } });

/** Every cover and thumbnail answers with the sample cover. */
export const coverHandlers = [
  http.get("/api/thumbs/:uuid/:size", svg),
  http.get("/api/covers/:uuid", svg),
];

/** The session `GET /api/auth/me` reports; `null` answers as a guest. */
export function sessionHandler(user: typeof WIRE_ADA | null = WIRE_ADA) {
  return user ? getGetMeMockHandler200(user) : getGetMeMockHandler401();
}

/** Title-ordered library pages of `pageSize`, with the API's paging headers. */
export function libraryHandler(books: EbookMetadata[], pageSize = 3) {
  return http.get("/api/ebooks", ({ request }) => {
    const url = new URL(request.url);
    // The API refuses a cursor unless sort and dir are both explicit.
    if (
      url.searchParams.get("sort") !== "title" ||
      url.searchParams.get("dir") !== "asc"
    ) {
      return new HttpResponse("cursor without sort and dir", { status: 400 });
    }
    const start = Number(url.searchParams.get("cursor") ?? "0");
    const end = start + pageSize;
    const headers: Record<string, string> = {
      "X-Total-Count": String(books.length),
    };
    if (end < books.length) headers["X-Next-Cursor"] = String(end);
    const page = { books: books.slice(start, end) } satisfies EbookPage;
    return HttpResponse.json(page, { headers });
  });
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
      current = { ...body, updated_at: Math.floor(Date.now() / 1000) };
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
 */
export function readStatusHandlers(
  initial: ReadStatusRecord | null,
  writes: { status: string }[] = [],
) {
  let current = initial;
  return [
    http.get("/api/read-status/:uuid", () => HttpResponse.json(current)),
    http.put("/api/read-status", async ({ request }) => {
      const body = PutReadStatusBody.parse(await request.json());
      writes.push(body);
      current = aWireReadStatus({
        ...body,
        finished_at:
          body.status === "finished" ? Math.floor(Date.now() / 1000) : null,
      });
      return HttpResponse.json(current);
    }),
  ];
}

/** `POST /api/books/:uuid/cross-format-follow`, answering `204` and appending the body to `writes`. */
export function followHandler(writes: { enabled: boolean }[]) {
  return http.post(
    "/api/books/:uuid/cross-format-follow",
    async ({ request }) => {
      writes.push(PostCrossFormatFollowBody.parse(await request.json()));
      return new HttpResponse(null, { status: 204 });
    },
  );
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
