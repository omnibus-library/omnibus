import { HttpResponse, http } from "msw";
import type {
  AudiobookManifest,
  AudiobookStatusState,
  Bookmark,
  CrossFormatResume,
  EbookMetadata,
  ProgressRecord,
  ReadStatusRecord,
} from "../api/generated/schemas";
import { bookHandler, coverHandlers } from "./handlers";
import {
  aWireAudioBookmark,
  aWireAudioManifest,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
} from "./wire";

// MSW fakes for the audiobook player: a book the listen routes all answer for.

/** Ten minutes into the first of three hour-long chapters. */
export const TEN_MINUTES_IN = aWirePosition({
  format: "audio",
  progress_percent: null,
  audio_position_seconds: 600,
  book_file_id: 917,
});

/** A two-file book: the first names the second as next, the second is the last. Records each manifest's `file_id`. */
export function twoFiles(requested: (string | null)[]) {
  return http.get("/api/audiobooks/:uuid/manifest", ({ request }) => {
    const file = new URL(request.url).searchParams.get("file_id");
    requested.push(file);
    return HttpResponse.json(
      aWireAudioManifest({
        book_file_id: file === "918" ? 918 : 917,
        audio_file_count: 2,
        next_file_id: file === "918" ? null : 918,
      }),
    );
  });
}

/** One write the player sent: `"POST /api/progress"` and the JSON body it carried. */
export type ListenWrite = { request: string; body: unknown };

type ListenOptions = {
  /** Every write lands here. */
  writes?: ListenWrite[];
  /** The manifest; `null` answers 404. */
  manifest?: AudiobookManifest | null;
  /** The HLS transcode state `/status` reports. */
  state?: AudiobookStatusState;
  /** The speed the reader saved, or `null` for none. */
  rate?: number | null;
  /** The reader's saved listening position. */
  row?: ProgressRecord | null;
  resume?: CrossFormatResume;
  bookmarks?: Bookmark[];
  /** The reader's read status: `null` for none, `"failed"` for a 500. */
  readStatus?: ReadStatusRecord | null | "failed";
  /** Answers `POST …/sync-point` with this refusal instead of a 204. */
  syncRefusal?: { status: number; message: string };
  /** Holds the manifest until it resolves. */
  gate?: Promise<void>;
};

/**
 * Every request the listen routes make for `book`, quiet by default: no saved position,
 * speed or bookmarks, a direct manifest and no linked ebook. Writes are recorded and kept
 * (a bookmark POSTed shows in the next GET).
 */
export function listenHandlers(
  book: EbookMetadata,
  {
    writes = [],
    manifest = aWireAudioManifest(),
    state = "preparing",
    rate = null,
    row = null,
    resume = { state: "not_linked", follow: false },
    bookmarks = [],
    readStatus = null,
    syncRefusal,
    gate,
  }: ListenOptions = {},
) {
  const uuid = book.unique_identifier;
  let saved = rate;
  let marks = [...bookmarks];
  const record = (request: string, body: unknown) =>
    writes.push({ request, body });
  return [
    bookHandler(book),
    ...coverHandlers,
    http.get("/api/audiobooks/:uuid/manifest", async () => {
      await gate;
      return manifest
        ? HttpResponse.json(manifest)
        : new HttpResponse("no audiobook", { status: 404 });
    }),
    http.get("/api/audiobooks/:uuid/status", () =>
      HttpResponse.json({ state, ready: state === "ready", progress: 0.5 }),
    ),
    // The player streams parts and segments with a real <audio>; an empty body is enough.
    http.get(
      "/api/audiobooks/:uuid/parts/:ordinal",
      () =>
        new HttpResponse(null, { headers: { "Content-Type": "audio/mpeg" } }),
    ),
    http.get("/api/audiobooks/:uuid/playback-rate", () =>
      HttpResponse.json(
        saved === null
          ? null
          : {
              book_uuid: uuid,
              playback_rate: saved,
              updated_at: 1_760_000_000,
            },
      ),
    ),
    http.put("/api/audiobooks/:uuid/playback-rate", async ({ request }) => {
      const body = (await request.json()) as { playback_rate: number };
      record("PUT /api/audiobooks/playback-rate", body);
      saved = body.playback_rate;
      return HttpResponse.json({
        book_uuid: uuid,
        playback_rate: saved,
        updated_at: 1_760_000_000,
      });
    }),
    http.get("/api/progress/:uuid", () =>
      HttpResponse.json(row ? aWireProgress(row) : aWireProgress()),
    ),
    http.post("/api/progress", async ({ request }) => {
      const body = await request.json();
      record("POST /api/progress", body);
      return HttpResponse.json(body);
    }),
    http.post("/api/progress/sessions", async ({ request }) => {
      record("POST /api/progress/sessions", await request.json());
      return HttpResponse.json({ recorded: 1 });
    }),
    http.get("/api/books/:uuid/cross-format-resume", () =>
      HttpResponse.json(resume),
    ),
    http.post("/api/books/:uuid/sync-point", async ({ request }) => {
      record("POST /api/books/sync-point", await request.json());
      return syncRefusal
        ? new HttpResponse(syncRefusal.message, { status: syncRefusal.status })
        : new HttpResponse(null, { status: 204 });
    }),
    http.get("/api/read-status/:uuid", () =>
      readStatus === "failed"
        ? new HttpResponse("no status", { status: 500 })
        : HttpResponse.json(readStatus),
    ),
    http.put("/api/read-status", async ({ request }) => {
      const body = (await request.json()) as { status: "reading" | "finished" };
      record("PUT /api/read-status", body);
      return HttpResponse.json(aWireReadStatus({ status: body.status }));
    }),
    http.get("/api/bookmarks/book/:uuid", () => HttpResponse.json(marks)),
    http.post("/api/bookmarks", async ({ request }) => {
      const body = (await request.json()) as { position: string };
      record("POST /api/bookmarks", body);
      const made = aWireAudioBookmark({
        id: Math.max(0, ...marks.map((m) => m.id)) + 1,
        position: body.position,
      });
      marks = [...marks, made];
      return HttpResponse.json(made);
    }),
    http.put("/api/bookmarks/:id", async ({ request, params }) => {
      const body = (await request.json()) as { title: string | null };
      record(`PUT /api/bookmarks/${params.id}`, body);
      marks = marks.map((m) =>
        String(m.id) === params.id ? { ...m, title: body.title } : m,
      );
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/bookmarks/:id", ({ params }) => {
      record(`DELETE /api/bookmarks/${params.id}`, null);
      marks = marks.filter((m) => String(m.id) !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
