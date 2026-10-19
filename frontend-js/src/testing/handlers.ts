import { delay, HttpResponse, http } from "msw";
import { COVER_SVG } from "./books";
import { WIRE_ADA } from "./wire";

// A fake of the Axum `/api/*` routes the client calls, for MSW. Each handler
// also checks the request the client sends, so a story that renders through
// one exercises api.ts's half of the contract.

const svg = () =>
  new HttpResponse(COVER_SVG, { headers: { "Content-Type": "image/svg+xml" } });

/** Every cover and thumbnail answers with the sample cover. */
export const coverHandlers = [
  http.get("/api/thumbs/:uuid/:size", svg),
  http.get("/api/covers/:uuid", svg),
];

/** The session `GET /api/auth/me` reports; `null` answers as a guest. */
export function sessionHandler(user: typeof WIRE_ADA | null = WIRE_ADA) {
  return http.get("/api/auth/me", () =>
    user ? HttpResponse.json(user) : new HttpResponse(null, { status: 401 }),
  );
}

/** Title-ordered library pages of `pageSize`, with the API's paging headers. */
export function libraryHandler(books: unknown[], pageSize = 3) {
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
    return HttpResponse.json({ books: books.slice(start, end) }, { headers });
  });
}

/** One book by uuid; any other uuid is a 404, as on the server. */
export function bookHandler(book: { unique_identifier: string }) {
  return http.get("/api/ebooks/:uuid", ({ params }) =>
    params.uuid === book.unique_identifier
      ? HttpResponse.json(book)
      : new HttpResponse(null, { status: 404 }),
  );
}

/** `GET /api/progress/recent`, answering the first `limit` of `points`. */
export function recentProgressHandler(points: unknown[]) {
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

/** `POST /api/auth/login` accepting `password` for any username. */
export function loginHandler(password: string) {
  return http.post("/api/auth/login", async ({ request }) => {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("password" in body)) {
      return new HttpResponse("missing credentials", { status: 422 });
    }
    return body.password === password
      ? HttpResponse.json({ user: WIRE_ADA })
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
export function hanging(path: string) {
  return http.get(path, async () => {
    await delay("infinite");
    return new HttpResponse(null);
  });
}
