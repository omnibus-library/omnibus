import { HttpResponse, http } from "msw";
import {
  type Bookmark,
  ClientStampedCreateBookmark,
  ClientStampedCreateHighlight,
  type CrossFormatResume,
  DeclareSyncPoint,
  type Highlight,
  type ProgressRecord,
  ProgressUpdate,
  UpdateHighlightColor,
  UpdateHighlightNote,
} from "../api/generated/schemas";
import { COVER_SVG } from "./books";
import {
  aWireBookmark,
  aWireHighlight,
  aWirePosition,
  aWireProgress,
} from "./wire";

// MSW fakes for the routes the readers call beyond the book itself.

/**
 * The progress `GET` serves `initial`; a `POST` appends its body to `writes` and answers
 * the position it stored.
 */
export function progressHandlers(
  initial: ProgressRecord[],
  writes: ProgressUpdate[],
) {
  return [
    http.get("/api/progress/:uuid", () =>
      HttpResponse.json(aWireProgress(...initial)),
    ),
    http.post("/api/progress", async ({ request }) => {
      const body = ProgressUpdate.parse(await request.json());
      writes.push(body);
      return HttpResponse.json(
        aWirePosition({
          book_uuid: body.book_uuid,
          epub_cfi: body.epub_cfi,
          progress_percent: body.progress_percent,
        }),
      );
    }),
  ];
}

/** Every comic page is the sample cover. */
export const comicPageHandler = http.get(
  "/api/ebooks/:uuid/pages/:page",
  () =>
    new HttpResponse(COVER_SVG, {
      headers: { "Content-Type": "image/svg+xml" },
    }),
);

/** One write a reader sent, for a story to read back. */
export type RecordedWrite = { method: string; path: string; body: unknown };

/**
 * The highlights and bookmarks `GET` lists, `POST` creates (ids count up from 100), `PATCH`
 * recolors or puts a note on a highlight, and `DELETE` removes, all against `state`; each write
 * lands in `writes`.
 */
export function annotationHandlers(
  state: { highlights: Highlight[]; bookmarks: Bookmark[] },
  writes: RecordedWrite[],
) {
  const record = (method: string, path: string, body?: unknown) =>
    writes.push({ method, path, body });
  const change = (id: number, patch: Partial<Highlight>) => {
    state.highlights = state.highlights.map((h) =>
      h.id === id ? { ...h, ...patch } : h,
    );
  };
  let nextId = 100;
  return [
    http.get("/api/highlights/book/:uuid", () =>
      HttpResponse.json(state.highlights),
    ),
    http.post("/api/highlights", async ({ request }) => {
      const body = ClientStampedCreateHighlight.parse(await request.json());
      record("POST", "/api/highlights", body);
      const made = aWireHighlight({
        id: nextId++,
        book_uuid: body.book_uuid,
        epub_cfi_range: body.epub_cfi_range,
        color: body.color,
        text: body.text ?? null,
      });
      state.highlights = [...state.highlights, made];
      return HttpResponse.json(made);
    }),
    http.patch("/api/highlights/:id/color", async ({ params, request }) => {
      const body = UpdateHighlightColor.parse(await request.json());
      record("PATCH", `/api/highlights/${params.id}/color`, body);
      change(Number(params.id), { color: body.color });
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch("/api/highlights/:id/note", async ({ params, request }) => {
      const body = UpdateHighlightNote.parse(await request.json());
      record("PATCH", `/api/highlights/${params.id}/note`, body);
      change(Number(params.id), { note: body.note ?? null });
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/highlights/:id", ({ params }) => {
      record("DELETE", `/api/highlights/${params.id}`);
      state.highlights = state.highlights.filter(
        (h) => h.id !== Number(params.id),
      );
      return new HttpResponse(null, { status: 204 });
    }),
    http.get("/api/bookmarks/book/:uuid", () =>
      HttpResponse.json(state.bookmarks),
    ),
    http.post("/api/bookmarks", async ({ request }) => {
      const body = ClientStampedCreateBookmark.parse(await request.json());
      record("POST", "/api/bookmarks", body);
      const made = aWireBookmark({
        id: nextId++,
        book_uuid: body.book_uuid,
        position: body.position,
        title: body.title ?? null,
      });
      state.bookmarks = [...state.bookmarks, made];
      return HttpResponse.json(made);
    }),
    http.delete("/api/bookmarks/:id", ({ params }) => {
      record("DELETE", `/api/bookmarks/${params.id}`);
      state.bookmarks = state.bookmarks.filter(
        (b) => b.id !== Number(params.id),
      );
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/**
 * The cross-format resume `GET` answers `state.resume`, and the sync-point `POST` answers 204;
 * both land in `calls`, the `GET` with its query so a story can read what was asked.
 */
export function crossFormatHandlers(
  state: { resume: CrossFormatResume },
  calls: RecordedWrite[],
) {
  return [
    http.get("/api/books/:uuid/cross-format-resume", ({ request }) => {
      const { pathname, search } = new URL(request.url);
      calls.push({ method: "GET", path: pathname + search, body: undefined });
      return HttpResponse.json(state.resume);
    }),
    http.post("/api/books/:uuid/sync-point", async ({ params, request }) => {
      const body = DeclareSyncPoint.parse(await request.json());
      calls.push({
        method: "POST",
        path: `/api/books/${params.uuid}/sync-point`,
        body,
      });
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
