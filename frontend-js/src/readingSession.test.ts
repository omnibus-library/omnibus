import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookUuid } from "./api";
import { SessionTracker, useReadingSession } from "./readingSession";

const A = "book-a" as BookUuid;
const B = "book-b" as BookUuid;

describe("SessionTracker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("minimum length", () => {
    it.each([
      ["drops a segment of 4 seconds", 4, false],
      ["keeps a segment of 5 seconds", 5, true],
    ])("%s", (_condition, seconds, kept) => {
      const tracker = new SessionTracker();
      tracker.start(A, 1000);

      const report = tracker.stop(1000 + seconds);

      expect(report !== null).toBe(kept);
    });
  });

  describe("start", () => {
    it("keeps the running segment when the same book starts again", () => {
      const tracker = new SessionTracker();
      tracker.start(A, 1000);

      expect(tracker.start(A, 1050)).toBeNull();
      expect(tracker.stop(1100)?.progress_units).toBe(100);
    });

    it("reports the old book's segment when another book starts", () => {
      const tracker = new SessionTracker();
      tracker.start(A, 1000);

      const ended = tracker.start(B, 1030);

      expect(ended).toMatchObject({
        book_uuid: A,
        format: "epub",
        started_at: 1000,
        ended_at: 1030,
        progress_units: 30,
      });
      expect(tracker.stop(1040)?.book_uuid).toBe(B);
    });
  });

  describe("suspend and resume", () => {
    it("reports the hidden segment and restarts the same book on resume", () => {
      const tracker = new SessionTracker();
      tracker.start(A, 1000);

      expect(tracker.suspend(1020)?.progress_units).toBe(20);
      tracker.resume(1500);

      expect(tracker.stop(1510)).toMatchObject({
        book_uuid: A,
        started_at: 1500,
        progress_units: 10,
      });
    });

    it("reports nothing for a resume with no book suspended", () => {
      const tracker = new SessionTracker();

      tracker.resume(1000);

      expect(tracker.stop(2000)).toBeNull();
    });
  });

  describe("rollover", () => {
    it("reports the segment and restarts it at now", () => {
      const tracker = new SessionTracker();
      tracker.start(A, 1000);

      expect(tracker.rollover(1060)?.progress_units).toBe(60);
      expect(tracker.stop(1090)?.started_at).toBe(1060);
    });

    it("keeps a segment under the floor accruing", () => {
      const tracker = new SessionTracker();
      tracker.start(A, 1000);

      expect(tracker.rollover(1003)).toBeNull();
      expect(tracker.stop(1010)?.started_at).toBe(1000);
    });
  });

  describe("report", () => {
    it("takes the offset in force when the segment started", () => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      const tracker = new SessionTracker();
      // 09:59Z on the 2026 spring-forward day, a minute before clocks jump from -08:00 to -07:00.
      const start = Date.parse("2026-03-08T09:59:00Z") / 1000;
      tracker.start(A, start);

      const report = tracker.stop(start + 600);

      expect(report?.utc_offset_minutes).toBe(-480);
      expect(report?.time_zone).toBe("America/Los_Angeles");
    });
  });
});

describe("useReadingSession", () => {
  const posted = () =>
    vi.mocked(fetch).mock.calls.map(([url, init]) => ({
      url,
      keepalive: init?.keepalive,
      body: JSON.parse(String(init?.body)),
    }));

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-05-01T12:00:00Z") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ recorded: 1 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flushes the sitting on unmount with keepalive", () => {
    const { unmount } = renderHook(() => useReadingSession(A));

    vi.advanceTimersByTime(20_000);
    unmount();

    expect(posted()).toEqual([
      {
        url: "/api/progress/sessions",
        keepalive: true,
        body: [expect.objectContaining({ book_uuid: A, progress_units: 20 })],
      },
    ]);
  });

  it("flushes a segment every minute while mounted", () => {
    renderHook(() => useReadingSession(A));

    vi.advanceTimersByTime(60_000);

    expect(posted().map((p) => p.body[0].progress_units)).toEqual([60]);
  });

  it("posts nothing for a sitting under five seconds", () => {
    const { unmount } = renderHook(() => useReadingSession(A));

    vi.advanceTimersByTime(3_000);
    unmount();

    expect(posted()).toEqual([]);
  });
});
