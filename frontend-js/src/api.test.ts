import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type BookUuid,
  type FilterClause,
  fetchRating,
  filterParam,
  toBookDetail,
  toBookPage,
  toPalette,
  toResumePoint,
  toShelf,
  toUser,
} from "./api";
import {
  aWireBook,
  aWirePalette,
  aWireResumePoint,
  aWireShelf,
  aWireStack,
  WIRE_ADA,
} from "./testing/wire";

const auroraWire = aWireBook({ published: null });

describe("toBookPage", () => {
  it("maps wire rows to books and reads paging from the headers", () => {
    const headers = new Headers({
      "X-Total-Count": "46",
      "X-Next-Cursor": "eyJzIjoiQXVyb3JhIn0",
      "X-Hidden-Count": "3",
    });

    const page = toBookPage({ path: "/lib", books: [auroraWire] }, headers);

    expect(page).toEqual({
      books: [
        {
          uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
          title: "Aurora Station, Vol. 1",
          authors: ["Sora Inkwell"],
          series: { name: "Aurora Station", index: "1" },
          accent: "oklch(0.555 0.153 28.4)",
          hasCover: true,
          subjects: [],
          genres: [],
          formats: ["CBZ"],
          published: null,
          language: null,
          addedAt: "2026-08-01T12:00:00Z",
          modified: "2026-08-02T12:00:00Z",
          hasPhysical: false,
          seriesId: null,
        },
      ],
      stacks: [],
      total: 46,
      next: "eyJzIjoiQXVyb3JhIn0",
      hidden: 3,
      path: "/lib",
    });
  });

  it("reports no next page when the cursor header is absent", () => {
    const page = toBookPage({ books: [] }, new Headers());

    expect(page).toEqual({
      books: [],
      stacks: [],
      total: 0,
      next: null,
      hidden: null,
      path: null,
    });
  });

  it("reads the stacks riding with the page", () => {
    const wire = aWireStack({
      lead_uuid: auroraWire.unique_identifier ?? "",
      members: [auroraWire],
      states: [{ uuid: "u", started: true, percent: 40 }],
    });

    const [stack] = toBookPage(
      { books: [], stacks: [wire] },
      new Headers(),
    ).stacks;

    expect(stack).toMatchObject({
      leadUuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
      name: "Saga",
      seriesId: 7,
      states: [{ uuid: "u", started: true, finished: false, percent: 40 }],
    });
    expect(stack?.members.map((b) => b.title)).toEqual([
      "Aurora Station, Vol. 1",
    ]);
  });

  it("falls back to the filename for a book with no title or cover", () => {
    const wire = { ...auroraWire, title: null, cover_url: null };

    const [book] = toBookPage({ books: [wire] }, new Headers()).books;

    expect(book).toMatchObject({
      title: "aurora-station-01.cbz",
      hasCover: false,
    });
  });

  it("falls back to the filename for a blank title", () => {
    const wire = { ...auroraWire, title: "  " };

    const [book] = toBookPage({ books: [wire] }, new Headers()).books;

    expect(book?.title).toBe("aurora-station-01.cbz");
  });

  it("rejects a row with no uuid", () => {
    const wire = { ...auroraWire, unique_identifier: null };

    expect(() => toBookPage({ books: [wire] }, new Headers())).toThrow();
  });
});

describe("toBookDetail", () => {
  it("defaults the genres the server omits when there are none", () => {
    const wire = { ...auroraWire, subjects: ["Space opera"] };

    expect(toBookDetail(wire)).toMatchObject({
      genres: [],
      subjects: ["Space opera"],
    });
  });

  it("treats a blank series name as no series", () => {
    const wire = { ...auroraWire, series: "  " };

    expect(toBookDetail(wire).series).toBeNull();
  });

  it("reads each format flag from the formats, M4A counting as audio", () => {
    const wire = { ...auroraWire, formats: ["EPUB", "m4a"] };

    expect(toBookDetail(wire)).toMatchObject({
      hasEbook: true,
      hasAudio: true,
      hasComic: false,
      hasPdf: false,
    });
  });
});

describe("toResumePoint", () => {
  it("maps each resume point to its book, format and file id", () => {
    const wire = aWireResumePoint(
      { format: "audio", book_file_id: 7 },
      { title: "The Martian", formats: ["M4B", "EPUB"] },
    );

    const point = toResumePoint(wire);

    expect(point).toMatchObject({
      book: {
        uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
        title: "The Martian",
      },
      format: "audio",
      fileId: 7,
      formats: ["M4B", "EPUB"],
    });
  });

  it("carries the position, the rate and the readout the stack draws", () => {
    const wire = {
      ...aWireResumePoint({
        format: "audio",
        audio_position_seconds: 3600,
        total_duration_seconds: 7200,
        progress_percent: 50,
        resolved: { confidence: "high", chapter_ordinal: 7 },
      }),
      playback_rate: 1.5,
      linked: true,
      audio_part: 3,
    };

    expect(toResumePoint(wire)).toMatchObject({
      key: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0:audio",
      percent: 50,
      positionSeconds: 3600,
      totalSeconds: 7200,
      playbackRate: 1.5,
      linked: true,
      chapter: 7,
      part: 3,
    });
  });

  it("reads a low-confidence chapter as none", () => {
    const wire = aWireResumePoint({
      resolved: { confidence: "low", chapter_ordinal: 7 },
    });

    expect(toResumePoint(wire).chapter).toBeNull();
  });

  it("carries the chapter and part totals the open-books list reads", () => {
    const wire = {
      ...aWireResumePoint({
        format: "audio",
        resolved: {
          confidence: "high",
          chapter_ordinal: 3,
          chapters_total: 12,
        },
      }),
      audio_part: 2,
      audio_part_count: 5,
    };

    expect(toResumePoint(wire)).toMatchObject({
      chapter: 3,
      chaptersTotal: 12,
      part: 2,
      partCount: 5,
    });
  });

  it("reads a low-confidence chapter total as none, like its chapter", () => {
    const wire = aWireResumePoint({
      resolved: { confidence: "low", chapter_ordinal: 3, chapters_total: 12 },
    });

    expect(toResumePoint(wire).chaptersTotal).toBeNull();
  });

  it("reports no totals when the server sends none", () => {
    expect(toResumePoint(aWireResumePoint())).toMatchObject({
      chaptersTotal: null,
      partCount: null,
    });
  });
});

describe("toShelf", () => {
  it("maps a shelf summary to its owner, kind, count and cover uuids", () => {
    const wire = aWireShelf({
      kind: "smart",
      visibility: "public",
      book_count: 12,
      cover_uuids: ["ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0"],
    });

    expect(toShelf(wire)).toEqual({
      id: 3,
      kind: "smart",
      visibility: "public",
      name: "Winter reads",
      accent: null,
      owner: { id: 1, name: "ada", hasAvatar: false },
      bookCount: 12,
      covers: ["ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0"],
    });
  });

  it("defaults the cover uuids the server omits", () => {
    const { cover_uuids: _omitted, ...wire } = aWireShelf();

    expect(toShelf(wire).covers).toEqual([]);
  });
});

describe("toUser", () => {
  it("maps the session user to its identity, role and avatar", () => {
    const wire = { ...WIRE_ADA, has_avatar: true };

    expect(toUser(wire)).toEqual({
      id: 1,
      username: "ada",
      name: "Ada Lovelace",
      isAdmin: true,
      canUpload: true,
      canEdit: true,
      hasAvatar: true,
      hiddenFormats: [],
      stackSeries: false,
    });
  });

  it("carries the library preferences the server sends", () => {
    const wire = { ...WIRE_ADA, hidden_formats: ["m4b"], stack_series: true };

    expect(toUser(wire)).toMatchObject({
      hiddenFormats: ["m4b"],
      stackSeries: true,
    });
  });

  it("falls back to the username when there is no display name", () => {
    const wire = { ...WIRE_ADA, display_name: null };

    expect(toUser(wire).name).toBe("ada");
  });
});

describe("toPalette", () => {
  it("defaults the totals the server omits", () => {
    const { book_total: _omitted, ...wire } = aWirePalette();

    expect(toPalette(wire).totals.books).toBe(0);
  });
});

describe("the nullable read fetchers", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (res: Response) => {
    vi.stubGlobal("fetch", async () => res);
  };

  it("fetchRating rejects with the server's text on a plain-text failure", async () => {
    answer(
      new Response("internal server error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    const err = await fetchRating("u" as BookUuid).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 500,
      message: "internal server error",
    });
  });

  it("fetchRating rejects a 200 body that is not a rating", async () => {
    answer(Response.json({ stars: "five" }));
    await expect(fetchRating("u" as BookUuid)).rejects.toThrow();
  });
});

describe("filterParam", () => {
  it("encodes one include clause as the server does", () => {
    const clause: FilterClause = {
      field: "author",
      mode: "include",
      values: ["Sora Inkwell"],
    };

    expect(filterParam([clause])).toBe(
      '[{"field":"author","mode":"include","values":["Sora Inkwell"]}]',
    );
  });

  it("fixes the key order whatever order the clause was built in", () => {
    const clause: FilterClause = {
      values: ["epub"],
      mode: "exclude",
      field: "format",
    };

    expect(filterParam([clause])).toBe(
      '[{"field":"format","mode":"exclude","values":["epub"]}]',
    );
  });

  it("sends nothing for no clauses", () => {
    expect(filterParam([])).toBeUndefined();
  });
});
