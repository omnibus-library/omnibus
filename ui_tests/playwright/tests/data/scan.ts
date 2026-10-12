import type { ShelfRef } from "./shelves";
import { uniqueDigits, uniqueSuffix } from "./unique";

/** A book as a metadata provider describes it (`ExternalBookMeta`). */
export type ExternalBookMeta = {
  isbn13: string;
  title: string;
  authors: string[];
  year: string | null;
  pages: number | null;
  publisher: string | null;
  description: string | null;
  cover_url: string | null;
  series: string | null;
  first_publish_year: number | null;
  source: "open_library";
};

/** A fileless book on a reader's wishlist, and the wishlist holding it. */
export type Wish = ExternalBookMeta & { uuid: string; shelf: ShelfRef };

/** A library book as an ISBN lookup reports it (`ScanBook`). */
export type ScanBook = {
  uuid: string;
  title: string;
  authors: string[];
  cover_url: string | null;
  has_physical: boolean;
  has_files: boolean;
  isbn?: string;
};

/** What an ISBN lookup answers (`ScanOutcome`), for the outcomes specs stub. */
export type ScanOutcome =
  | { kind: "in_library_unowned"; book: ScanBook }
  | { kind: "not_in_library"; online: ExternalBookMeta };

/** The lookup of a book only the metadata providers know. */
export function notInLibrary(book: ExternalBookMeta): ScanOutcome {
  return { kind: "not_in_library", online: book };
}

/** The lookup of a book in the library with no copy of the reader's. */
export function inLibraryUnowned(wish: Wish): ScanOutcome {
  return {
    kind: "in_library_unowned",
    book: {
      uuid: wish.uuid,
      title: wish.title,
      authors: wish.authors,
      cover_url: null,
      has_physical: true,
      has_files: false,
      isbn: wish.isbn13,
    },
  };
}

/** A valid ISBN-13 under the 979 prefix, which no fixture uses. */
export function uniqueIsbn13(): string {
  const body = `979${uniqueDigits()}`;
  const sum = [...body].reduce(
    (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Provider metadata whose title, author and ISBN no other book shares. */
export function buildExternalBook(
  overrides: Partial<ExternalBookMeta> = {},
): ExternalBookMeta {
  const suffix = uniqueSuffix();
  return {
    isbn13: uniqueIsbn13(),
    title: `E2E Wished For ${suffix}`,
    authors: [`Wren Wishlisted ${suffix}`],
    year: "2021",
    pages: null,
    publisher: null,
    description: null,
    cover_url: null,
    series: null,
    first_publish_year: null,
    source: "open_library",
    ...overrides,
  };
}
