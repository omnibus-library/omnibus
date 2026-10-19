import { describe, expect, it } from "vitest";
import {
  type FilterClause,
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
        },
      ],
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
      total: 0,
      next: null,
      hidden: null,
      path: null,
    });
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
      ownerId: 1,
      ownerName: "ada",
      bookCount: 12,
      coverUuids: ["ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0"],
    });
  });

  it("defaults the cover uuids the server omits", () => {
    const { cover_uuids: _omitted, ...wire } = aWireShelf();

    expect(toShelf(wire).coverUuids).toEqual([]);
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
      hasAvatar: true,
      hiddenFormats: [],
      stackSeries: false,
      canEdit: true,
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
