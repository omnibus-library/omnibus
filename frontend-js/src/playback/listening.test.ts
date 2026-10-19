import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BookUuid } from "../api";
import { aWireReadStatus } from "../testing/wire";
import {
  applyAutoReadStatus,
  autoTransition,
  ListeningTracker,
} from "./listening";

const A = "book-a" as BookUuid;

describe("ListeningTracker", () => {
  it.each([
    ["drops a stretch of 4 seconds", 4, false],
    ["keeps a stretch of 5 seconds", 5, true],
  ])("%s", (_name, seconds, kept) => {
    const tracker = new ListeningTracker();
    tracker.start(A, 1000);

    expect(tracker.stop(1000 + seconds) !== null).toBe(kept);
  });

  it("reports an audio session with its clock, zone and length", () => {
    const tracker = new ListeningTracker();
    tracker.start(A, 1_760_000_000);

    expect(tracker.stop(1_760_000_090)).toEqual({
      book_uuid: A,
      format: "audio",
      started_at: 1_760_000_000,
      ended_at: 1_760_000_090,
      progress_units: 90,
      utc_offset_minutes: -new Date(1_760_000_000 * 1000).getTimezoneOffset(),
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("keeps the running stretch when the same book starts again", () => {
    const tracker = new ListeningTracker();
    tracker.start(A, 1000);
    tracker.start(A, 1050);

    expect(tracker.stop(1100)?.progress_units).toBe(100);
  });

  it("reports nothing when no stretch ran", () => {
    expect(new ListeningTracker().stop(2000)).toBeNull();
  });

  it("rolls the stretch over: reports it and restarts at now", () => {
    const tracker = new ListeningTracker();
    tracker.start(A, 1000);

    expect(tracker.rollover(1060)).toMatchObject({
      started_at: 1000,
      ended_at: 1060,
    });
    expect(tracker.stop(1070)).toMatchObject({
      started_at: 1060,
      progress_units: 10,
    });
  });

  it("keeps a stretch under the floor accruing at rollover", () => {
    const tracker = new ListeningTracker();
    tracker.start(A, 1000);

    expect(tracker.rollover(1003)).toBeNull();
    expect(tracker.stop(1010)?.progress_units).toBe(10);
  });
});

describe("autoTransition", () => {
  it.each([
    ["unread", false, "reading"],
    ["reading", false, null],
    ["finished", false, null],
    ["unread", true, "finished"],
    ["reading", true, "finished"],
    ["finished", true, null],
  ] as const)("moves %s (at end: %s) to %s", (current, atEnd, next) => {
    expect(autoTransition(current, atEnd)).toBe(next);
  });
});

describe("applyAutoReadStatus", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  /** A server holding `stored` (or failing the read); returns the PUT bodies it was sent. */
  function serve(stored: "unread" | "finished" | "failed") {
    const puts: unknown[] = [];
    server.use(
      http.get("/api/read-status/:uuid", () =>
        stored === "failed"
          ? new HttpResponse("no", { status: 500 })
          : HttpResponse.json(
              stored === "unread" ? null : aWireReadStatus({ status: stored }),
            ),
      ),
      http.put("/api/read-status", async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(aWireReadStatus({ status: "reading" }));
      }),
    );
    return puts;
  }

  it("marks a book with no status reading on its first play", async () => {
    const puts = serve("unread");

    await applyAutoReadStatus(A, false);

    expect(puts).toEqual([{ book_uuid: A, status: "reading" }]);
  });

  it("writes nothing when the status could not be read, so finished is never downgraded", async () => {
    const puts = serve("failed");

    await applyAutoReadStatus(A, false);

    expect(puts).toEqual([]);
  });

  it("marks a book finished at its end", async () => {
    const puts = serve("unread");

    await applyAutoReadStatus(A, true);

    expect(puts).toEqual([{ book_uuid: A, status: "finished" }]);
  });

  it("leaves a finished book finished at its end", async () => {
    const puts = serve("finished");

    await applyAutoReadStatus(A, true);

    expect(puts).toEqual([]);
  });
});
