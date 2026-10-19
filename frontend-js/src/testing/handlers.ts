import { delay, HttpResponse, http } from "msw";
import {
  getGetAuthorsMockHandler200,
  getGetGenresMockHandler200,
  getGetMeMockHandler200,
  getGetMeMockHandler401,
  getGetRegistrationMockHandler200,
  getGetTagsMockHandler200,
  getListSeriesMockHandler200,
} from "../api/generated/omnibus.msw";
import type {
  AuthorSummary,
  EbookMetadata,
  EbookPage,
  GenreWeight,
  LoginResponse,
  PaletteResults,
  ResumePoint,
  SeriesSummary,
  TagWeight,
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

/**
 * Library pages of `pageSize` in fixture order, with the API's paging headers.
 * Each request's search params land in `requests`, for assertions.
 */
export function libraryHandler(
  books: EbookMetadata[],
  pageSize = 3,
  {
    path = LIBRARY_PATH,
    requests = [],
  }: { path?: string | null; requests?: URLSearchParams[] } = {},
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
    const start = Number(url.searchParams.get("cursor") ?? "0");
    const end = start + pageSize;
    const headers: Record<string, string> = {
      "X-Total-Count": String(books.length),
    };
    if (end < books.length) headers["X-Next-Cursor"] = String(end);
    const page = { books: books.slice(start, end), path } satisfies EbookPage;
    return HttpResponse.json(page, { headers });
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
