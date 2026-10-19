import {
  type Book,
  type BookUuid,
  parseBookUuid,
  type SeriesStack,
  type Shelf,
  type UserId,
} from "../api";

function bookUuid(raw: string): BookUuid {
  const uuid = parseBookUuid(raw);
  if (!uuid) throw new Error(`not a book uuid: ${raw}`);
  return uuid;
}

/** A 2:3 cover as SVG markup, for the fake API to serve. */
export const COVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#b5483a"/><text x="200" y="300" font-size="38" text-anchor="middle" fill="#f5e9dc" font-family="serif">Aurora Station</text></svg>';

/** The same cover drawn inline, so stories and tests need no server. */
export const COVER_ART = `data:image/svg+xml;utf8,${encodeURIComponent(COVER_SVG)}`;

/** A book as the library list returns it; override what a case needs. */
export function aBook(overrides: Partial<Book> = {}): Book {
  return {
    uuid: bookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0"),
    title: "Aurora Station, Vol. 1",
    authors: ["Sora Inkwell"],
    series: { name: "Aurora Station", index: "1" },
    accent: "oklch(0.555 0.153 28.4)",
    hasCover: true,
    subjects: [],
    genres: [],
    formats: ["CBZ"],
    published: "2021-03-01",
    language: null,
    addedAt: null,
    modified: null,
    hasPhysical: false,
    seriesId: null,
    ...overrides,
  };
}

/** A hand-picked shelf the signed-in reader (user 1) owns; override what a case needs. */
export function aShelf(overrides: Partial<Shelf> = {}): Shelf {
  return {
    id: 3,
    kind: "manual",
    visibility: "private",
    name: "Winter reads",
    ownerId: 1 as UserId,
    ownerName: "ada",
    bookCount: 12,
    coverUuids: [],
    ...overrides,
  };
}

/** A folded series as the library list parses it; override what a case needs. */
export function aStack(overrides: Partial<SeriesStack> = {}): SeriesStack {
  return {
    leadUuid: "s1",
    name: "Saga",
    seriesId: 7,
    members: [aBook()],
    states: [],
    ...overrides,
  };
}
