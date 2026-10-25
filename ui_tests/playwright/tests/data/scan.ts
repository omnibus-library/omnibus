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
  /** The server leaves this out when unknown, and `first_publish_year` too. */
  series?: string;
  first_publish_year?: number;
  /** The edition's physical format, such as `Paperback`; left out when unknown. */
  format?: string;
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

/** What an ISBN lookup or a search pick returns (`ScanOutcome`). */
export type ScanOutcome =
  | { kind: "already_owned"; book: ScanBook }
  | { kind: "on_wishlist"; book: ScanBook }
  | { kind: "in_library_unowned"; book: ScanBook }
  | {
      kind: "close_match";
      book: ScanBook;
      others: ScanBook[];
      scanned: ExternalBookMeta;
    }
  | { kind: "not_in_library"; online: ExternalBookMeta }
  | { kind: "unresolved" };

/** How the reader found a book they wished for (`WishlistSource`). */
export type WishlistSource = "scan" | "detail" | "manual" | "search";

/** What every check-in write returns (`BookRef`), naming the book it filed. */
export type BookRef = { book_uuid: string };

/** `uuid`'s row as a lookup reports it, by default with files and no copy. */
export function libraryBook(
  book: Pick<ScanBook, "title" | "authors">,
  uuid: string,
  overrides: Partial<ScanBook> = {},
): ScanBook {
  return {
    uuid,
    title: book.title,
    authors: book.authors,
    cover_url: null,
    has_physical: false,
    has_files: true,
    ...overrides,
  };
}

/** A wished-for book's row once its first copy is filed. */
export function filedBook(wish: Wish): ScanBook {
  return libraryBook(wish, wish.uuid, {
    has_physical: true,
    has_files: false,
    isbn: wish.isbn13,
  });
}

/** The lookup of a book that already has a physical copy. */
export function alreadyOwned(book: ScanBook): ScanOutcome {
  return { kind: "already_owned", book };
}

/** The lookup of a book on the reader's wishlist. */
export function onWishlist(book: ScanBook): ScanOutcome {
  return { kind: "on_wishlist", book };
}

/** The lookup of a book in the library with no copy of the reader's. */
export function inLibraryUnowned(book: ScanBook): ScanOutcome {
  return { kind: "in_library_unowned", book };
}

/** A provider answer whose title and author matched these library books. */
export function closeMatch(
  scanned: ExternalBookMeta,
  [book, ...others]: [ScanBook, ...ScanBook[]],
): ScanOutcome {
  return { kind: "close_match", book, others, scanned };
}

/** The lookup of a book only the metadata providers know. */
export function notInLibrary(book: ExternalBookMeta): ScanOutcome {
  return { kind: "not_in_library", online: book };
}

/** The lookup of an ISBN neither the library nor any provider knows. */
export function unresolved(): ScanOutcome {
  return { kind: "unresolved" };
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
    source: "open_library",
    ...overrides,
  };
}
