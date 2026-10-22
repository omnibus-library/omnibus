import type { BookDetail } from "../../api";
import { formatDateShort, formatInstantShort } from "../../format";

type Identifier = BookDetail["identifiers"][number];

/** One row of the metadata table's identifier block. */
export type IdentifierRow = { key: string; label: string; value: string };

// How well a label names what its row holds: a value's shape, the source's own
// scheme as written, or a scheme this table can name properly.
const INFERRED = 0;
const RAW_SCHEME = 1;
const KNOWN = 2;

// ONIX codelist-5 numbers (an EPUB 3 `identifier-type` refinement) and the
// scheme names Calibre and the retailers write. `uuid` is the source file's
// uuid, not the book's own.
const KNOWN_SCHEMES: Record<string, string> = {
  "01": "Proprietary ID",
  proprietary: "Proprietary ID",
  "02": "ISBN-10",
  "isbn-10": "ISBN-10",
  isbn10: "ISBN-10",
  "03": "EAN-13",
  "gtin-13": "EAN-13",
  ean: "EAN-13",
  "ean-13": "EAN-13",
  "04": "UPC",
  upc: "UPC",
  "05": "ISMN-10",
  "ismn-10": "ISMN-10",
  "06": "DOI",
  doi: "DOI",
  "13": "LCCN",
  lccn: "LCCN",
  "14": "GTIN-14",
  "gtin-14": "GTIN-14",
  "15": "ISBN-13",
  "isbn-13": "ISBN-13",
  isbn13: "ISBN-13",
  "17": "ISBN-A",
  "isbn-a": "ISBN-A",
  "22": "URN",
  urn: "URN",
  "23": "OCLC",
  oclc: "OCLC",
  "24": "URL",
  url: "URL",
  uri: "URL",
  "25": "ISMN-13",
  "ismn-13": "ISMN-13",
  isbn: "ISBN",
  asin: "ASIN",
  amazon: "ASIN",
  "mobi-asin": "ASIN",
  google: "Google Books ID",
  goodreads: "Goodreads ID",
  calibre: "Calibre ID",
  uuid: "Source UUID",
};

const stripped = (value: string) => value.replace(/[\s-]/g, "");

function isbn10ChecksumOk(chars: string[]): boolean {
  let sum = 0;
  for (const [i, c] of chars.entries()) {
    const isCheckX = i === 9 && c.toLowerCase() === "x";
    if (!isCheckX && !/^\d$/.test(c)) return false;
    sum += (isCheckX ? 10 : Number(c)) * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13ChecksumOk(chars: string[]): boolean {
  if (!chars.every((c) => /^\d$/.test(c))) return false;
  const sum = chars.reduce(
    (s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return sum % 10 === 0;
}

/** Whether `value` is an ISBN, check digit included. Only a label guess uses it. */
export function looksLikeIsbn(value: string): boolean {
  const chars = [...stripped(value)];
  if (chars.length === 10) return isbn10ChecksumOk(chars);
  return chars.length === 13 && isbn13ChecksumOk(chars);
}

function labelFor({ scheme, value }: Identifier): [string, number] {
  const trimmed = scheme?.trim() ?? "";
  const known = KNOWN_SCHEMES[trimmed.toLowerCase()];
  if (known) return [known, KNOWN];
  // An unrecognised all-digit scheme is a codelist value, not a name to show.
  if (
    trimmed &&
    trimmed.toLowerCase() !== "unknown" &&
    !/^\d+$/.test(trimmed)
  ) {
    return [trimmed, RAW_SCHEME];
  }
  return [looksLikeIsbn(value) ? "ISBN" : "Identifier", INFERRED];
}

// The value's ISBN shape (13 digits, or 9 plus a digit or X) after dropping a
// `urn:isbn:` / `isbn:` prefix. No checksum, so a mistyped ISBN still collapses.
function isbnValue(value: string): string | null {
  const lower = value.trim().toLowerCase();
  const bare = lower.replace(/^(urn:isbn:|isbn:|isbn )/, "");
  const cleaned = stripped(bare);
  return /^(\d{13}|\d{9}[\dx])$/.test(cleaned) ? cleaned.toUpperCase() : null;
}

// Narrow on purpose: `foo-123` and `foo123` stay distinct.
function sameIdentifier(a: string, b: string): boolean {
  const isbn = isbnValue(a);
  return (
    a.toLowerCase() === b.toLowerCase() ||
    (isbn !== null && isbn === isbnValue(b))
  );
}

type Ranked = { row: IdentifierRow; rank: number };

function rowFor(ident: Identifier, value: string): Ranked {
  const [label, rank] = labelFor(ident);
  return {
    row: { key: JSON.stringify([ident.scheme, ident.value]), label, value },
    rank,
  };
}

// A saved ISBN replaces the row holding the same ISBN, else the row with its
// label, else is appended; other rows of that ISBN then go. Never by label alone,
// since a book can carry two distinct ISBNs.
function applyIsbnOverride(
  rows: Ranked[],
  scheme: string,
  raw: string | null | undefined,
) {
  const value = raw?.trim();
  if (!value) return rows;
  const next = rowFor({ scheme, value }, value);
  const at = rows.findIndex((r) => sameIdentifier(r.row.value, value));
  const slot =
    at >= 0 ? at : rows.findIndex((r) => r.row.label === next.row.label);
  const placed =
    slot >= 0 ? rows.map((r, i) => (i === slot ? next : r)) : [...rows, next];
  return placed.filter(
    (r) => r.row.value === value || !sameIdentifier(r.row.value, value),
  );
}

/**
 * The identifier rows to show: one per distinct value, keeping the best-named
 * label and the first position, with the saved ISBN-13 and ISBN-10 folded in.
 */
export function identifierRows(
  book: Pick<BookDetail, "identifiers" | "isbn10" | "isbn13">,
): IdentifierRow[] {
  const rows: Ranked[] = [];
  for (const ident of book.identifiers) {
    const value = ident.value.trim();
    if (!value) continue;
    const next = rowFor(ident, value);
    const at = rows.findIndex((r) => sameIdentifier(r.row.value, value));
    if (at < 0) rows.push(next);
    // Strictly better only: a tie keeps the first, so the order stays the file's.
    else if (next.rank > (rows[at]?.rank ?? 0)) rows[at] = next;
  }
  const folded = applyIsbnOverride(
    applyIsbnOverride(rows, "isbn-13", book.isbn13),
    "isbn-10",
    book.isbn10,
  );
  return folded.map((r) => r.row);
}

/** A row of the Details list: a value, or a field the editor can fill that is still empty. */
export type DetailRow =
  | { key: string; label: string; value: string }
  | {
      key: "publisher" | "published" | "language" | "isbn13";
      label: string;
      unset: true;
    };

const isIsbn = (row: IdentifierRow) => row.label.startsWith("ISBN");

/**
 * The Details list: title and author, the publisher, publication date and language,
 * the identifiers with the ISBN first, then the book's UUID and when it was added. The
 * four fields a reader can fill read as unset when empty; any other row is absent, not
 * blank. Published is a calendar date and never shifted; Added is an instant and
 * lands on the reader's own day.
 */
export function detailRows(book: BookDetail): DetailRow[] {
  const settable = (
    key: "publisher" | "published" | "language" | "isbn13",
    label: string,
    value: string | null | undefined,
  ): DetailRow => (value ? { key, label, value } : { key, label, unset: true });
  const ids = identifierRows(book);
  const identifiers: DetailRow[] = ids.some(isIsbn)
    ? [...ids.filter(isIsbn), ...ids.filter((row) => !isIsbn(row))]
    : [settable("isbn13", "ISBN", null), ...ids];
  const author = book.authors.join(", ");
  const added = book.addedAt && formatInstantShort(book.addedAt);
  return [
    { key: "title", label: "Title", value: book.title },
    ...(author ? [{ key: "author", label: "Author", value: author }] : []),
    settable("publisher", "Publisher", book.publisher),
    settable(
      "published",
      "Published",
      book.published && formatDateShort(book.published),
    ),
    settable("language", "Language", book.language),
    ...identifiers,
    { key: "uuid", label: "UUID", value: book.uuid },
    ...(added ? [{ key: "added", label: "Added", value: added }] : []),
  ];
}
