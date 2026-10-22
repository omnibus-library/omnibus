import { describe, expect, it } from "vitest";
import {
  type Alignment,
  type Position,
  type Progress,
  toAlignment,
} from "../../api";
import {
  chapterIndexForCfi,
  chapterNow,
  chapterSegments,
  continueLabel,
  factLine,
  homeReadout,
  interpolatePairs,
  linkedAudioAt,
  newestPercent,
  shortChapterTitle,
} from "./readout";

type Chapter = NonNullable<Alignment["chapters"]>[number];

function chapter(
  spineIndex: number,
  anchorPath: string | null = null,
  percent = 0,
): Chapter {
  return { title: `Chapter at ${spineIndex}`, percent, spineIndex, anchorPath };
}

const spines = (...indices: number[]) => indices.map((s) => chapter(s));

function position(overrides: Partial<Position> = {}): Position {
  return {
    cfi: null,
    percent: null,
    derivedCfi: null,
    audioSeconds: null,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("chapterIndexForCfi", () => {
  it("picks the chapter by spine item, not by percent", () => {
    const chapters = spines(2, 4, 6);

    expect(chapterIndexForCfi(chapters, "epubcfi(/6/10!/4/2:0)")).toBe(1);
  });

  it("keeps a CFI past the last chapter on the last chapter", () => {
    expect(chapterIndexForCfi(spines(2, 4, 6), "epubcfi(/6/20!/4)")).toBe(2);
  });

  it.each([
    ["before the first chapter", "epubcfi(/6/2!/4)"],
    ["on an odd package step", "epubcfi(/6/13!/4)"],
    ["on a zero package step", "epubcfi(/6/0!/4)"],
    ["not a CFI", "not-a-cfi"],
  ])("returns null for a CFI %s", (_condition, cfi) => {
    expect(chapterIndexForCfi(spines(2, 4, 6), cfi)).toBeNull();
  });

  describe("chapters sharing a spine item", () => {
    // Front matter opens item 3; chapters one and two follow at /4/32 and /4/68.
    const shared = [
      chapter(0),
      chapter(3),
      chapter(3, "/4/32"),
      chapter(3, "/4/68"),
      chapter(5),
    ];

    it.each([
      ["ahead of the first anchor", "epubcfi(/6/8!/4/24/1:0)", 1],
      ["on the anchor", "epubcfi(/6/8!/4/32)", 2],
      ["inside the first chapter", "epubcfi(/6/8[item4]!/4/50/1:120)", 2],
      ["in a highlight range", "epubcfi(/6/8!/4/50,/1:0,/1:20)", 2],
      ["past the second anchor", "epubcfi(/6/8!/4/68/1:0)", 3],
      ["at the end of the item", "epubcfi(/6/8!/4/300/3:9)", 3],
      ["in the next item", "epubcfi(/6/12!/4/2/1:0)", 4],
    ])("places a position %s", (_condition, cfi, index) => {
      expect(chapterIndexForCfi(shared, cfi)).toBe(index);
    });

    it("opens a shared item on its first chapter ahead of every anchor", () => {
      const chapters = [chapter(3, "/4/32"), chapter(3, "/4/68")];

      expect(chapterIndexForCfi(chapters, "epubcfi(/6/8!/4/2/1:0)")).toBe(0);
    });

    it("names the last chapter of an item whose anchors were never recorded", () => {
      expect(chapterIndexForCfi(spines(0, 3, 3, 5), "epubcfi(/6/8!/4)")).toBe(
        2,
      );
    });
  });
});

describe("shortChapterTitle", () => {
  it("leaves a title within 32 characters alone", () => {
    expect(shortChapterTitle("  Cinder ")).toBe("Cinder");
  });

  it("cuts a long title on a word boundary and trims trailing dashes", () => {
    expect(shortChapterTitle("CHAPTER XIII DR. SEWARD'S DIARY—continued")).toBe(
      "CHAPTER XIII DR. SEWARD'S…",
    );
    expect(
      shortChapterTitle("The Vestibule of the Sixteenth Hall, north"),
    ).toBe("The Vestibule of the Sixteenth…");
    expect(
      shortChapterTitle("A very long chapter title - that runs on and on"),
    ).toBe("A very long chapter title…");
  });
});

describe("chapterNow", () => {
  const chapters = [
    chapter(0, null, 0),
    chapter(2, null, 40),
    chapter(4, null, 80),
  ];

  it("prefers the CFI's chapter, numbered from 1", () => {
    const now = chapterNow(
      chapters,
      position({ cfi: "epubcfi(/6/6!/4)", percent: 90 }),
    );

    expect(now).toEqual({ n: 2, title: "Chapter at 2" });
  });

  it("falls back to the percent once it is past the start", () => {
    expect(chapterNow(chapters, position({ percent: 85 }))?.n).toBe(3);
    expect(chapterNow(chapters, position({ percent: 0 }))).toBeNull();
  });

  it("returns null without a position or a chapter table", () => {
    expect(chapterNow(chapters, null)).toBeNull();
    expect(chapterNow([], position({ percent: 50 }))).toBeNull();
  });
});

describe("homeReadout", () => {
  const alignment = toAlignment({
    audio_files: [
      {
        book_file_id: 1,
        duration_seconds: 3600,
        chapter_starts: [],
        label: "one",
      },
      {
        book_file_id: 2,
        duration_seconds: 7200,
        chapter_starts: [],
        label: "two",
      },
    ],
    ebook: {
      total_chars: 100,
      chapters: [chapter(0), chapter(2)].map((c) => ({
        title: c.title,
        percent: c.percent,
        spine_index: c.spineIndex,
      })),
    },
    listening: { book_file_id: 2, seconds: 1800, client_updated_at: 5 },
  });

  it("places the listening position on the whole timeline", () => {
    const readout = homeReadout(alignment, null);

    expect(readout).toMatchObject({
      chTotal: 2,
      audioAt: "1h 30m",
      audioTotal: "3h 00m",
      audioLeftSecs: 5400,
    });
  });

  it("is empty before the alignment loads", () => {
    expect(homeReadout(undefined, null)).toEqual({
      chTotal: null,
      chNow: null,
      audioAt: null,
      audioTotal: null,
      audioLeftSecs: null,
    });
  });

  it("counts no ruler ticks for a single chapter", () => {
    const single = toAlignment({
      audio_files: [],
      ebook: { total_chars: 1, chapters: [{ title: "Only", percent: 0 }] },
    });

    expect(homeReadout(single, null).chTotal).toBeNull();
  });
});

describe("linkedAudioAt", () => {
  const files = [
    {
      book_file_id: 1,
      duration_seconds: 7200,
      chapter_starts: [],
      label: "one",
    },
  ];

  it("names the listening position when there is one", () => {
    const aligned = toAlignment({
      audio_files: files,
      listening: { book_file_id: 1, seconds: 3600, client_updated_at: 1 },
    });

    expect(linkedAudioAt(aligned)).toBe("1h 00m");
  });

  it("maps the reading position through the anchor pairs otherwise", () => {
    const aligned = toAlignment({
      audio_files: files,
      reading: { percent: 50, client_updated_at: 1 },
      anchor_pairs: [[0.5, 0.25]],
    });

    expect(linkedAudioAt(aligned)).toBe("30m");
  });

  it("is null without an audio timeline", () => {
    expect(
      linkedAudioAt(
        toAlignment({
          audio_files: [],
          reading: { percent: 50, client_updated_at: 1 },
        }),
      ),
    ).toBeNull();
  });
});

describe("interpolatePairs", () => {
  it("is the identity with no anchors", () => {
    expect(interpolatePairs([], 0.3)).toBeCloseTo(0.3);
  });

  it("bends through an anchor", () => {
    expect(interpolatePairs([[0.5, 0.25]], 0.25)).toBeCloseTo(0.125);
    expect(interpolatePairs([[0.5, 0.25]], 0.75)).toBeCloseTo(0.625);
  });
});

describe("newestPercent", () => {
  const progress = (
    reading: Partial<Position> | null,
    listening: Partial<Position> | null,
  ): Progress => ({
    reading: reading && position(reading),
    listening: listening && position(listening),
  });

  it("takes the format saved last", () => {
    expect(
      newestPercent(
        progress({ percent: 10, updatedAt: 5 }, { percent: 60, updatedAt: 9 }),
      ),
    ).toBe(60);
    expect(
      newestPercent(
        progress({ percent: 10, updatedAt: 9 }, { percent: 60, updatedAt: 5 }),
      ),
    ).toBe(10);
  });

  it("prefers reading on a tie", () => {
    expect(
      newestPercent(
        progress({ percent: 10, updatedAt: 5 }, { percent: 60, updatedAt: 5 }),
      ),
    ).toBe(10);
  });

  it("skips a format with no percent", () => {
    expect(
      newestPercent(
        progress(
          { percent: null, updatedAt: 9 },
          { percent: 60, updatedAt: 5 },
        ),
      ),
    ).toBe(60);
    expect(newestPercent(progress(null, null))).toBeNull();
  });
});

describe("factLine", () => {
  const facts = {
    published: "2014-02-18",
    publisher: "Del Rey",
    pageCount: 382,
    language: "en",
  };

  it("joins year publisher pages and language", () => {
    expect(factLine(facts)).toBe("2014 · Del Rey · 382 pages · English");
  });

  it("leaves out what is unknown", () => {
    expect(
      factLine({
        published: null,
        publisher: "Del Rey",
        pageCount: null,
        language: null,
      }),
    ).toBe("Del Rey");
    expect(
      factLine({
        published: null,
        publisher: null,
        pageCount: null,
        language: null,
      }),
    ).toBeNull();
  });

  it("says one page for a one-page book", () => {
    expect(factLine({ ...facts, pageCount: 1 })).toContain("1 page ·");
  });

  it("names a language code in English", () => {
    expect(factLine({ ...facts, language: "fr" })).toContain("French");
  });

  it("keeps a language that is not a code as it is", () => {
    expect(factLine({ ...facts, language: "Klingon!" })).toContain("Klingon!");
  });
});

describe("chapterSegments", () => {
  // Five chapters opening at 0, 15, 40, 70 and 85 percent of the book.
  const book = [0, 15, 40, 70, 85].map((start) => chapter(0, null, start));

  it("weights each chapter by its share of the book", () => {
    expect(chapterSegments(book, 0).map((s) => s.weight)).toEqual([
      15, 25, 30, 15, 15,
    ]);
  });

  it("counts a first chapter that opens late from the start of the book", () => {
    const late = [10, 50].map((start) => chapter(0, null, start));

    expect(chapterSegments(late, 0).map((s) => s.weight)).toEqual([50, 50]);
  });

  it("marks chapters before the position done and fills the current one", () => {
    const segments = chapterSegments(book, 62);

    expect(segments.map((s) => s.state)).toEqual([
      "done",
      "done",
      "current",
      "ahead",
      "ahead",
    ]);
    // 22 of the current chapter's 30 percent.
    expect(segments[2]?.fill).toBeCloseTo(73.33, 1);
  });

  it("opens the current chapter empty at the exact start of it", () => {
    const segments = chapterSegments(book, 40);

    expect(segments[2]).toMatchObject({ state: "current", fill: 0 });
    expect(segments[1]?.state).toBe("done");
  });

  it("marks every chapter done at the end of the book", () => {
    expect(chapterSegments(book, 100).map((s) => s.state)).toEqual(
      Array(5).fill("done"),
    );
  });

  it.each([
    ["no table", null],
    ["an empty table", []],
  ])(
    "returns one segment without a chapter table (%s)",
    (_condition, table) => {
      expect(chapterSegments(table, 62)).toEqual([
        { weight: 100, state: "current", fill: 62 },
      ]);
    },
  );
});

describe("continueLabel", () => {
  const ebook = { audioOnly: false, chapter: null } as const;
  const audio = { audioOnly: true, chapter: null } as const;

  it("starts reading an unread ebook", () => {
    expect(continueLabel({ ...ebook, status: "unread" })).toBe("Start reading");
  });

  it("continues at the chapter", () => {
    expect(continueLabel({ ...ebook, status: "reading", chapter: 3 })).toBe(
      "Continue · Chapter 3",
    );
  });

  it("continues reading when the chapter is not known", () => {
    expect(continueLabel({ ...ebook, status: "reading" })).toBe(
      "Continue reading",
    );
  });

  it("starts listening to an audiobook only book", () => {
    expect(continueLabel({ ...audio, status: "unread" })).toBe(
      "Start listening",
    );
  });

  it("continues listening", () => {
    expect(continueLabel({ ...audio, status: "reading" })).toBe(
      "Continue listening",
    );
  });

  it("reads again once finished", () => {
    expect(continueLabel({ ...ebook, status: "finished" })).toBe("Read again");
  });

  it("listens again once finished", () => {
    expect(continueLabel({ ...audio, status: "finished" })).toBe(
      "Listen again",
    );
  });
});
