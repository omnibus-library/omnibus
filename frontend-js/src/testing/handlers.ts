import { delay, HttpResponse, http } from "msw";
import type { FilterClause, FilterField } from "../api";
import {
  getGetAuthorsMockHandler200,
  getGetGenresMockHandler200,
  getGetMeMockHandler200,
  getGetMeMockHandler401,
  getGetRegistrationMockHandler200,
  getGetTagsMockHandler200,
  getListSeriesMockHandler200,
  getListShelvesMockHandler200,
} from "../api/generated/omnibus.msw";
import {
  AddShelfBooksBody,
  type AuthorSummary,
  BulkOverridesRequest,
  type EbookMetadata,
  type EbookPage,
  type GenreWeight,
  type LoginResponse,
  type PaletteResults,
  type ResumePoint,
  type SeriesStack,
  type SeriesSummary,
  type ShelfSummary,
  type TagWeight,
} from "../api/generated/schemas";
import { COVER_SVG } from "./books";
import { WIRE_ADA } from "./wire";

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

/** The library path the fixture server reports on page 1. */
export const LIBRARY_PATH = "/library";

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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
  user = WIRE_ADA,
}: {
  bodies?: unknown[];
  gate?: Promise<void>;
  user?: typeof WIRE_ADA;
} = {}) {
  let enabled = user.stack_series ?? false;
  return [
    http.get("/api/auth/me", () =>
      HttpResponse.json({ ...user, stack_series: enabled }),
    ),
    http.post("/api/account/stack-series", async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      await gate;
      if (body && typeof body === "object" && "enabled" in body) {
        enabled = body.enabled === true;
      }
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
}: {
  added?: { id: number; uuids: string[] }[];
  refuse?: string;
} = {}) {
  return http.post("/api/shelves/:id/books", async ({ params, request }) => {
    if (refuse) return new HttpResponse(refuse, { status: 403 });
    const body = AddShelfBooksBody.parse(await request.json());
    added.push({ id: Number(params.id), uuids: body.book_uuids });
    return new HttpResponse(null, { status: 204 });
  });
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

/** Answers `path` with `status` and a plain-text body, as an Axum error does. */
export function failing(method: "get" | "post", path: string, status: number) {
  return http[method](
    path,
    () => new HttpResponse(`failed with ${status}`, { status }),
  );
}

/** Never answers `path`, to hold a screen in its loading state. */
export function hanging(path: string, method: "get" | "post" = "get") {
  return http[method](path, async () => {
    await delay("infinite");
    return new HttpResponse(null);
  });
}
