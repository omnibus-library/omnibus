import { describe, expect, it } from "vitest";
import {
  ApiError,
  classifyPick,
  formFromAudiobookInspection,
  formFromEbookInspection,
  uploadFailureMessage,
} from "../api";
import {
  anAudiobookInspection,
  anEbookInspection,
} from "../testing/uploadHandlers";

describe("classifyPick", () => {
  it.each([
    [["book.epub"], "ebook"],
    [["SCAN.PDF"], "ebook"],
    [["book.m4b"], "audiobook"],
    [["part1.mp3", "part2.mp3", "cover-art.MP3"], "audiobook"],
  ])("sends %j to the %s ingest", (names, kind) => {
    expect(classifyPick(names)).toEqual({ ok: true, kind });
  });

  it.each([
    [
      ["notes.txt"],
      "notes.txt isn't a format Omnibus can add — pick an EPUB or PDF, an M4B/M4A/MP4 audiobook, or MP3 parts.",
    ],
    [["a.epub", "b.epub"], "Add one EPUB at a time."],
    [
      ["a.epub", "b.mp3"],
      "Pick either an EPUB or an audiobook's files, not both.",
    ],
    [[], "Choose a file first."],
  ])("refuses %j before sending anything", (names, reason) => {
    expect(classifyPick(names)).toEqual({ ok: false, reason });
  });
});

describe("formFromEbookInspection", () => {
  it("reads every field the inspection found", () => {
    expect(formFromEbookInspection(anEbookInspection())).toEqual({
      title: "The Salt Road",
      description: "A caravan crosses the dry sea.",
      publisher: "Lantern Press",
      published: "2020-05-01",
      language: "en",
      series: "Tidewater",
      seriesIndex: "2",
      isbn13: "9780134685991",
      isbn10: "",
      printPages: "",
      authors: ["Mara Okafor", "Jun Aoki"],
      tags: ["travel"],
      genres: [],
    });
  });

  it("leaves what the file does not declare blank", () => {
    const form = formFromEbookInspection(
      anEbookInspection({
        title: null,
        creators: undefined,
        subjects: undefined,
        series: null,
      }),
    );

    expect(form).toMatchObject({
      title: "",
      authors: [],
      tags: [],
      series: "",
    });
  });
});

describe("formFromAudiobookInspection", () => {
  it("fills the title and artist and leaves the rest blank", () => {
    expect(formFromAudiobookInspection(anAudiobookInspection())).toMatchObject({
      title: "Harbour Lights",
      authors: ["Ines Varga"],
      series: "",
      description: "",
      tags: [],
    });
  });
});

describe("uploadFailureMessage", () => {
  it("names the size limit for a 413", () => {
    expect(uploadFailureMessage(new ApiError(413, "too big"))).toBe(
      "That file is larger than this server accepts.",
    );
  });

  it("says the upload stopped when the connection dropped (status 0)", () => {
    expect(uploadFailureMessage(new ApiError(0, ""))).toBe(
      "The upload stopped before the server answered. The file may be larger than this server accepts.",
    );
  });

  it("passes on the server's own text otherwise", () => {
    expect(uploadFailureMessage(new ApiError(400, "not an epub"))).toBe(
      "not an epub",
    );
  });
});
