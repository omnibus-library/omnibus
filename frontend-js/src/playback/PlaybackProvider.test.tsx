import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { BookUuid } from "../api";
import { bookQuery } from "../pages/BookDetail/queries";
import { harnessClient } from "../testing/AppHarness";
import {
  type ListenWrite,
  listenHandlers,
  TEN_MINUTES_IN,
  twoFiles,
} from "../testing/audioHandlers";
import { aWireBook, aWireHlsManifest } from "../testing/wire";
import {
  type Playback,
  PlaybackProvider,
  usePlayback,
} from "./PlaybackProvider";

vi.mock("./loadHls", () => ({
  loadHls: () => Promise.reject(new Error("hls.js is blocked")),
}));

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0" as BookUuid;
const BOOK = aWireBook({ formats: ["M4B"] });

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

const writes: ListenWrite[] = [];
const wrote = (request: string) =>
  writes.filter((w) => w.request === request).map((w) => w.body);

beforeEach(() => {
  writes.length = 0;
  server.use(...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }));
});

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

let player: Playback;
function Probe() {
  player = usePlayback();
  return null;
}

function mount() {
  const client = harnessClient();
  render(
    <QueryClientProvider client={client}>
      <PlaybackProvider>
        <Probe />
      </PlaybackProvider>
    </QueryClientProvider>,
  );
  return client;
}

const audio = () => {
  const el = document.querySelector("audio");
  if (!el) throw new Error("no <audio> rendered");
  return el;
};

describe("PlaybackProvider", () => {
  describe("boot", () => {
    it("fails when the saved position cannot be read, rather than starting from 0", async () => {
      server.use(
        http.get(
          "/api/progress/:uuid",
          () => new HttpResponse("no", { status: 500 }),
        ),
      );
      mount();

      act(() => player.open(UUID, null));

      await waitFor(() => expect(player.failed).toBe(true));
      expect(player.ready).toBe(false);
    });

    it("hands an hls stream to a native player when hls.js cannot load", async () => {
      vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue(
        "maybe",
      );
      server.use(
        ...listenHandlers(BOOK, {
          writes,
          manifest: aWireHlsManifest(),
          state: "ready",
        }),
      );
      mount();

      act(() => player.open(UUID, null));

      await waitFor(() => expect(player.ready).toBe(true));
      expect(player.failed).toBe(false);
      expect(audio().getAttribute("src")).toContain("playlist.m3u8");
    });

    it("keeps the speed the listener picks while the server's is still on its way", async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get("/api/audiobooks/:uuid/playback-rate", async () => {
          await held;
          return HttpResponse.json({
            book_uuid: UUID,
            playback_rate: 2,
            updated_at: 1_760_000_000,
          });
        }),
      );
      mount();
      act(() => player.open(UUID, null));

      act(() => player.setRate(1.5));
      release();

      await waitFor(() => expect(player.ready).toBe(true));
      expect(player.rate).toBe(1.5);
    });

    it("keeps playing when a link names the file already playing", async () => {
      mount();
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.loadedFileId).toBe(917));
      await waitFor(() => expect(player.ready).toBe(true));

      act(() => player.open(UUID, 917));

      expect(player.ready).toBe(true);
    });
  });

  describe("while a transcode is preparing", () => {
    it("ignores play and skip, so nothing is saved over the resume position", async () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, "play");
      server.use(
        ...listenHandlers(BOOK, {
          writes,
          row: TEN_MINUTES_IN,
          manifest: aWireHlsManifest(),
          state: "preparing",
        }),
      );
      mount();
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.loadedFileId).toBe(917));

      act(() => {
        player.skip(-30);
        player.toggle();
      });

      expect(localStorage.getItem(`omn.listening::${UUID}`)).toBeNull();
      expect(play).not.toHaveBeenCalled();
    });
  });

  describe("sleep timer", () => {
    it("keeps counting across another file of the same book", async () => {
      server.use(twoFiles([]));
      mount();
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.loadedFileId).toBe(917));
      act(() => player.sleepFor(900));

      act(() => player.open(UUID, 918));

      await waitFor(() => expect(player.loadedFileId).toBe(918));
      expect(player.sleep.remaining).not.toBeNull();
    });

    it("is cancelled when another book opens", async () => {
      mount();
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.ready).toBe(true));
      act(() => player.sleepFor(900));

      act(() => player.open("another-book" as BookUuid, null));

      expect(player.sleep.remaining).toBeNull();
    });
  });

  describe("book", () => {
    it("follows the cached book, so an edit reaches the dock", async () => {
      const client = mount();
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.book.status).toBe("ready"));

      act(() =>
        client.setQueryData(bookQuery(UUID).queryKey, (book) =>
          book ? { ...book, title: "Renamed" } : book,
        ),
      );

      await waitFor(() =>
        expect(player.book).toMatchObject({
          status: "ready",
          book: { title: "Renamed" },
        }),
      );
    });

    it("marks the book's cached pages stale once the first play writes its read status", async () => {
      const client = mount();
      const key = ["book", UUID, "readStatus"];
      client.setQueryData(key, null);
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.ready).toBe(true));

      act(() => {
        audio().dispatchEvent(new Event("play"));
      });

      await waitFor(() =>
        expect(client.getQueryState(key)?.isInvalidated).toBe(true),
      );
      expect(wrote("PUT /api/read-status")).toEqual([
        { book_uuid: UUID, status: "reading" },
      ]);
    });
  });

  describe("flush", () => {
    it("reports the open stretch and the position", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
      mount();
      act(() => player.open(UUID, null));
      await waitFor(() => expect(player.ready).toBe(true));
      act(() => {
        audio().dispatchEvent(new Event("play"));
      });
      await waitFor(() => expect(player.playing).toBe(true));
      now.mockReturnValue(1_760_000_006_000);

      await act(() => player.flush());

      expect(wrote("POST /api/progress/sessions")).toMatchObject([
        [{ book_uuid: UUID, started_at: 1_760_000_000, progress_units: 6 }],
      ]);
      expect(wrote("POST /api/progress")).toEqual([
        {
          book_uuid: UUID,
          format: "audio",
          audio_position_seconds: 600,
          book_file_id: 917,
        },
      ]);
    });
  });
});
