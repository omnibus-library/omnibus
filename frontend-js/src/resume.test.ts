import { describe, expect, it } from "vitest";
import {
  formatHmLeft,
  formatHmsShort,
  readerHref,
  resumeHref,
  resumeMeta,
} from "./resume";
import { aResumePoint as aPoint, bookUuid } from "./testing/books";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

describe("resumeHref", () => {
  it("opens the player at the saved file for an audio position", () => {
    const point = aPoint({ format: "audio", fileId: 7, formats: ["M4B"] });

    expect(resumeHref(point)).toBe(`/listen/${UUID}?file_id=7`);
  });

  it("opens the epub reader when the book has an epub", () => {
    const point = aPoint({ formats: ["PDF", "EPUB", "CBZ"] });

    expect(resumeHref(point)).toBe(`/read/${UUID}`);
  });

  it("opens the comic reader for a cbz-only book", () => {
    const point = aPoint({ formats: ["CBZ", "PDF"] });

    expect(resumeHref(point)).toBe(`/comic/${UUID}`);
  });

  it("opens the pdf reader for a pdf-only book", () => {
    const point = aPoint({ formats: ["pdf"] });

    expect(resumeHref(point)).toBe(`/pdf/${UUID}`);
  });

  it("opens the player at its first file when the position names none", () => {
    const point = aPoint({ format: "audio", formats: ["MP3"] });

    expect(resumeHref(point)).toBe(`/listen/${UUID}`);
  });
});

describe("readerHref", () => {
  const uuid = bookUuid(UUID);

  it("opens the player at the file for an audio position", () => {
    expect(readerHref(uuid, ["M4B"], "audio", 7)).toBe(
      `/listen/${UUID}?file_id=7`,
    );
  });

  it("opens the player at its first file for an unread audio-only book", () => {
    expect(readerHref(uuid, ["m4b"], null, null)).toBe(`/listen/${UUID}`);
  });

  it("opens the reader for an unread book that has an epub beside its audio", () => {
    expect(readerHref(uuid, ["M4B", "EPUB"], null, null)).toBe(`/read/${UUID}`);
  });

  it("opens the epub reader when a book has no readable or audio format", () => {
    expect(readerHref(uuid, [], null, null)).toBe(`/read/${UUID}`);
  });
});

// An hour into a two-hour audiobook, in part 3 of 10.
const listening = aPoint({
  format: "audio",
  positionSeconds: 3600,
  totalSeconds: 7200,
  part: 3,
});

describe("resumeMeta", () => {
  it("reads an ebook with a stored percent as that percent", () => {
    expect(resumeMeta(aPoint({ percent: 42 }))).toEqual({
      meta: "42% · Continue reading",
      percent: 42,
    });
  });

  it("reads an ebook with no percent as a plain continue", () => {
    expect(resumeMeta(aPoint())).toEqual({
      meta: "Continue reading",
      percent: null,
    });
  });

  it("reports percent and time left for audio with a total", () => {
    expect(resumeMeta({ ...listening, chapter: 7 })).toEqual({
      meta: "Ch. 7 · 50% · 1h 00m left",
      percent: 50,
    });
  });

  it("names a part rather than a chapter without a confident chapter", () => {
    expect(resumeMeta(listening).meta).toBe("Pt. 3 · 50% · 1h 00m left");
  });

  it("drops the prefix when the book names neither", () => {
    expect(resumeMeta({ ...listening, part: null }).meta).toBe(
      "50% · 1h 00m left",
    );
  });

  it("scales time left by the saved playback rate but not the percent", () => {
    expect(resumeMeta({ ...listening, playbackRate: 2 })).toEqual({
      meta: "Pt. 3 · 50% · 30m left",
      percent: 50,
    });
  });

  it("falls back to the raw position for audio without a total", () => {
    const point = aPoint({ format: "audio", positionSeconds: 95 });

    expect(resumeMeta(point)).toEqual({ meta: "1:35 in", percent: null });
  });
});

describe("formatHmLeft", () => {
  it.each([
    [4712, "1h 19m"],
    [240, "4m"],
    [-5, "0m"],
  ])("writes %s seconds as %s", (seconds, text) => {
    expect(formatHmLeft(seconds)).toBe(text);
  });
});

describe("formatHmsShort", () => {
  it.each([
    [3725, "1:02:05"],
    [95, "1:35"],
    [Number.NaN, "0:00"],
  ])("writes %s seconds as %s", (seconds, text) => {
    expect(formatHmsShort(seconds)).toBe(text);
  });
});
