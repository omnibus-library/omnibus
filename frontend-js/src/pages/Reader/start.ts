import type { BookUuid, Position } from "../../api";

/** Whether an anchor is an EPUB CFI at all; a `pdf-page:` or `comic-page:` anchor on a mixed book never reaches epub.js. */
export const isEpubCfi = (anchor: string) =>
  anchor.trimStart().startsWith("epubcfi(");

/** The `?file_id=` a reader opens, for a book with several files of one format; `null` when absent or not a number. */
export const fileIdParam = (search: URLSearchParams) => {
  const raw = search.get("file_id");
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
};

// Dioxus's key, so both clients share one local position per origin.
const localKey = (uuid: BookUuid) => `omn.reading::${uuid}`;

/** This device's last saved CFI for a book, the first-paint cache behind the server's row. */
export function loadLocalPosition(uuid: BookUuid): string | null {
  try {
    return localStorage.getItem(localKey(uuid));
  } catch {
    return null;
  }
}

export function saveLocalPosition(uuid: BookUuid, cfi: string) {
  try {
    localStorage.setItem(localKey(uuid), cfi);
  } catch {
    // Storage blocked: the server's row still holds the position.
  }
}

/** The stored whole-book percent when it places the reader past the cover (1 to 100); a 0 is the start itself. */
export const furtherInPercent = (record: Position | null) => {
  const percent = record?.percent ?? null;
  return percent !== null && percent >= 1 && percent <= 100 ? percent : null;
};

/**
 * Where the reader opens: a `?cfi=` deep link outright, else the server's own CFI, else the
 * CFI it derived for a percent-only row, else this device's last save. `holdFirstWrite` is set
 * when it opens at the start under a stored percent it could not place: that landing is where
 * the reader was put, and writing it would put the cover over the stored position.
 */
export function readerStart(
  deepLink: string | null,
  record: Position | null,
  localSaved: string | null,
): { cfi: string | null; holdFirstWrite: boolean } {
  if (deepLink !== null) return { cfi: deepLink, holdFirstWrite: false };
  const placeable = (anchor: string | null) =>
    anchor !== null && isEpubCfi(anchor) ? anchor : null;
  // The server's row outranks the local save: an accepted write replaces the whole row, so a
  // percent-only row is newer than any CFI this client posted.
  const cfi =
    placeable(record?.cfi ?? null) ??
    placeable(record?.derivedCfi ?? null) ??
    localSaved;
  return {
    cfi,
    holdFirstWrite: cfi === null && furtherInPercent(record) !== null,
  };
}
