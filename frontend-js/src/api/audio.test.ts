import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../testing/handlers";
import { aWireAudioBookmark } from "../testing/wire";
import {
  dropQueuedAudioWrites,
  fetchAudioBookmarks,
  saveListeningPosition,
  savePlaybackRate,
} from "./audio";
import type { BookUuid } from "./core";

const A = "book-a" as BookUuid;

describe("fetchAudioBookmarks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps only positions that are seconds, dropping an ebook's CFI and a blank one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          aWireAudioBookmark({ id: 1, position: "600" }),
          aWireAudioBookmark({ id: 2, position: "epubcfi(/6/4!/4/2/1:0)" }),
          aWireAudioBookmark({ id: 3, position: "" }),
          aWireAudioBookmark({ id: 4, position: " " }),
        ]),
      ),
    );

    const bookmarks = await fetchAudioBookmarks(A);

    expect(bookmarks.map((b) => b.id)).toEqual([1]);
  });
});

/** A server that finishes each write in the order it is done with it; the one carrying `slow` waits for `gate`. */
function stubHeldServer(gate: Promise<void>, slow: number) {
  const processed: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const value = body.playback_rate ?? body.audio_position_seconds;
      if (value === slow) await gate;
      processed.push(value);
      return Response.json({});
    }),
  );
  return processed;
}

describe("ordered audio writes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets the server keep the last speed the listener chose", async () => {
    const held = deferred();
    const processed = stubHeldServer(held.promise, 1.25);

    const first = savePlaybackRate(A, 1.25);
    const second = savePlaybackRate(A, 1.5);
    held.release();
    await Promise.all([first, second]);

    expect(processed).toEqual([1.25, 1.5]);
  });

  it("lets the server keep the last listening position sent", async () => {
    const held = deferred();
    const processed = stubHeldServer(held.promise, 600);

    const first = saveListeningPosition(A, 3, 600);
    const second = saveListeningPosition(A, 3, 610);
    held.release();
    await Promise.all([first, second]);

    expect(processed).toEqual([600, 610]);
  });
});

describe("dropQueuedAudioWrites", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops a position save still queued when the session ends", async () => {
    const held = deferred();
    const processed = stubHeldServer(held.promise, 600);

    const first = saveListeningPosition(A, 3, 600);
    const queued = saveListeningPosition(A, 3, 610);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    dropQueuedAudioWrites();
    held.release();
    await Promise.all([first, queued]);

    expect(processed).toEqual([600]);
  });

  it("drops a speed save still queued when the session ends", async () => {
    const held = deferred();
    const processed = stubHeldServer(held.promise, 1.25);

    const first = savePlaybackRate(A, 1.25);
    const queued = savePlaybackRate(A, 1.5);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    dropQueuedAudioWrites();
    held.release();
    await Promise.all([first, queued]);

    expect(processed).toEqual([1.25]);
  });
});
