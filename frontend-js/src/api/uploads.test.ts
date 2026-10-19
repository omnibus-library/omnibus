import { describe, expect, it } from "vitest";
import {
  ApiError,
  classifyPick,
  commitFields,
  formFromAudiobookInspection,
  formFromEbookInspection,
  hasIdentity,
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

describe("commitFields", () => {
  const BASE = formFromEbookInspection(anEbookInspection());
  const KEEP = { kind: "keep" } as const;

  it("sends the identity and series, and no overrides for an untouched review", () => {
    expect(commitFields(BASE, BASE, KEEP)).toEqual([
      ["title", "The Salt Road"],
      ["author", "Mara Okafor"],
      ["series", "Tidewater"],
      ["series_index", "2"],
    ]);
  });

  it("trims the identity and leaves out a blank series", () => {
    const values = { ...BASE, title: "  Salt  ", series: " ", seriesIndex: "" };

    expect(commitFields(BASE, values, KEEP)).toEqual([
      ["title", "Salt"],
      ["author", "Mara Okafor"],
      [
        "overrides",
        JSON.stringify({ title: "  Salt  ", series: " ", series_index: "" }),
      ],
    ]);
  });

  it("carries only the changed fields as overrides", () => {
    const values = {
      ...BASE,
      publisher: "Other Press",
      tags: ["travel", "sea"],
    };

    const fields = commitFields(BASE, values, KEEP);

    expect(fields.at(-1)).toEqual([
      "overrides",
      JSON.stringify({ publisher: "Other Press", subjects: ["travel", "sea"] }),
    ]);
  });

  it("adds a picked image or a provider's URL as the cover", () => {
    const file = new File(["png"], "mine.png");

    expect(commitFields(BASE, BASE, { kind: "file", file }).at(-1)).toEqual([
      "cover",
      file,
    ]);
    expect(
      commitFields(BASE, BASE, {
        kind: "url",
        url: "https://img.example/a.jpg",
      }).at(-1),
    ).toEqual(["cover_url", "https://img.example/a.jpg"]);
  });
});

describe("hasIdentity", () => {
  const BASE = formFromEbookInspection(anEbookInspection());

  it("needs a title and a first author, ignoring blanks", () => {
    expect(hasIdentity(BASE)).toBe(true);
    expect(hasIdentity({ ...BASE, title: "  " })).toBe(false);
    expect(hasIdentity({ ...BASE, authors: [] })).toBe(false);
    expect(hasIdentity({ ...BASE, authors: [" "] })).toBe(false);
  });
});
