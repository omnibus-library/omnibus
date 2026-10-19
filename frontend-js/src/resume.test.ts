import { describe, expect, it } from "vitest";
import type { ResumePoint } from "./api";
import { resumeHref } from "./resume";
import { aBook } from "./testing/books";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function aPoint(overrides: Partial<ResumePoint> = {}): ResumePoint {
  return {
    book: aBook(),
    format: "epub",
    fileId: null,
    formats: ["EPUB"],
    ...overrides,
  };
}

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
