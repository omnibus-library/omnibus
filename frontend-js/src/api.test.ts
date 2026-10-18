import { describe, expect, it } from "vitest";
import { parseBookDetail, parseBookPage } from "./api";

const auroraWire = {
  id: 2,
  filename: "aurora-station-01.cbz",
  title: "Aurora Station, Vol. 1",
  description: null,
  publisher: null,
  published: null,
  language: null,
  creators: [{ name: "Sora Inkwell", role: null, file_as: null, id: 2 }],
  subjects: [],
  identifiers: [],
  series: "Aurora Station",
  series_index: "1",
  unique_identifier: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
  cover_url: "/api/covers/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
  accent: "oklch(0.555 0.153 28.4)",
  formats: ["CBZ"],
  error: null,
  has_override: false,
  has_cover_override: false,
};

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
