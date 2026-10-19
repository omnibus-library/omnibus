import { describe, expect, it } from "vitest";
import {
  toBookDetail,
  toBookPage,
  toPalette,
  toResumePoint,
  toUser,
} from "./api";
import {
  aWireBook,
  aWirePalette,
  aWireResumePoint,
  WIRE_ADA,
} from "./testing/wire";

const auroraWire = aWireBook({ published: null });

describe("toBookPage", () => {
  it("maps wire rows to books and reads paging from the headers", () => {
    const headers = new Headers({
      "X-Total-Count": "46",
      "X-Next-Cursor": "eyJzIjoiQXVyb3JhIn0",
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
        },
      ],
      total: 46,
      next: "eyJzIjoiQXVyb3JhIn0",
    });
  });

  it("reports no next page when the cursor header is absent", () => {
    const page = toBookPage({ books: [] }, new Headers());

    expect(page).toEqual({ books: [], total: 0, next: null });
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
