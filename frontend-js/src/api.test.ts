import { describe, expect, it } from "vitest";
import {
  parseBookDetail,
  parseBookPage,
  parsePalette,
  parseResumePoints,
  parseUser,
  registerErrorField,
} from "./api";
import {
  aWireBook,
  aWirePalette,
  aWireResumePoint,
  WIRE_ADA,
} from "./testing/wire";

const auroraWire = aWireBook({ published: null });

describe("parseBookPage", () => {
  it("maps wire rows to books and reads paging from the headers", () => {
    const headers = new Headers({
      "X-Total-Count": "46",
      "X-Next-Cursor": "eyJzIjoiQXVyb3JhIn0",
    });

    const page = parseBookPage({ path: "/lib", books: [auroraWire] }, headers);

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
    const page = parseBookPage({ books: [] }, new Headers());

    expect(page).toEqual({ books: [], total: 0, next: null });
  });

  it("falls back to the filename for a book with no title or cover", () => {
    const wire = { ...auroraWire, title: null, cover_url: null };

    const [book] = parseBookPage({ books: [wire] }, new Headers()).books;

    expect(book).toMatchObject({
      title: "aurora-station-01.cbz",
      hasCover: false,
    });
  });

  it("rejects a row with no uuid", () => {
    const wire = { ...auroraWire, unique_identifier: null };

    expect(() => parseBookPage({ books: [wire] }, new Headers())).toThrow();
  });
});

describe("parseBookDetail", () => {
  it("defaults the genres the server omits when there are none", () => {
    const wire = { ...auroraWire, subjects: ["Space opera"] };

    expect(parseBookDetail(wire)).toMatchObject({
      genres: [],
      subjects: ["Space opera"],
    });
  });

  it("treats a blank series name as no series", () => {
    const wire = { ...auroraWire, series: "  " };

    expect(parseBookDetail(wire).series).toBeNull();
  });
});

describe("parseResumePoints", () => {
  it("maps each resume point to its book, format and file id", () => {
    const wire = aWireResumePoint(
      { format: "audio", book_file_id: 7 },
      { title: "The Martian", formats: ["M4B", "EPUB"] },
    );

    const [point] = parseResumePoints([wire]);

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

describe("parseUser", () => {
  it("maps the session user to its identity, role and avatar", () => {
    const wire = { ...WIRE_ADA, has_avatar: true };

    expect(parseUser(wire)).toEqual({
      id: 1,
      username: "ada",
      name: "Ada Lovelace",
      isAdmin: true,
      canUpload: true,
      hasAvatar: true,
    });
  });

  it("falls back to the username when there is no display name", () => {
    const wire = { ...WIRE_ADA, display_name: null };

    expect(parseUser(wire).name).toBe("ada");
  });
});

describe("parsePalette", () => {
  it("defaults the totals the server omits", () => {
    const { book_total: _omitted, ...wire } = aWirePalette();

    expect(parsePalette(wire).totals.books).toBe(0);
  });
});

describe("registerErrorField", () => {
  it.each([
    ["username", "username already taken"],
    ["username", "User already exists"],
    ["password", "Password must be at least 10 characters"],
    ["banner", "Registration is closed"],
  ])("routes the refusal to the %s for %j", (field, message) => {
    expect(registerErrorField(message)).toBe(field);
  });
});
