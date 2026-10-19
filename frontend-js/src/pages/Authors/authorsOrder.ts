import type { AuthorId, AuthorReading, AuthorSummary } from "../../api";
import type { DiscoveryPrefs } from "../../viewPrefs";

export type AuthorSort = DiscoveryPrefs["authors_sort"];

/** The reader's progress per author id, once it has loaded. */
export type ReadingMap = Map<number, AuthorReading>;

export const byAuthor = (rows: AuthorReading[]): ReadingMap =>
  new Map(rows.map((r) => [r.authorId, r]));

/** Case and accents folded away, for matching typed text; mirrors `fold_for_match` in `shared/`. */
export function foldForMatch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

// Mirrors `dictionary_key` in `shared/src/sort_order.rs`: the comma files below every printable character.
const dictionaryKey = (text: string) =>
  foldForMatch(text).replaceAll(",", "\0");

function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(j) ?? 0;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return a.length - i - (b.length - j);
}

/**
 * The library's dictionary order: accents and case ignored, the plain spelling first
 * only when two names are otherwise identical. `fold` lets a sort memoise the key.
 */
export function dictionaryCmp(
  a: string,
  b: string,
  fold: (text: string) => string = dictionaryKey,
): number {
  return compareCodePoints(fold(a), fold(b)) || compareCodePoints(a, b);
}

/** A display name as `Surname, Given`; a name with a comma, or a mononym, is kept. */
function authorSortKey(name: string): string {
  const trimmed = name.trim();
  const space = trimmed.lastIndexOf(" ");
  if (trimmed.includes(",") || space < 0) return trimmed;
  return `${trimmed.slice(space + 1)}, ${trimmed.slice(0, space)}`;
}

/** The surname-first key a creator files under; `fileAs` is trusted only in `Surname, Given` form. */
export function creatorSortKey(fileAs: string | null, name: string): string {
  const trimmed = fileAs?.trim();
  if (trimmed?.includes(",")) return trimmed;
  if (trimmed && name.trim() === "") return authorSortKey(trimmed);
  return authorSortKey(name);
}

const sortKey = (a: AuthorSummary) => creatorSortKey(a.sort, a.name);

const foldedInitial = (key: string) =>
  foldForMatch([...key][0] ?? "").charAt(0);

const isAlpha = (c: string) => /^[a-z]$/i.test(c);

/** The letter an author files under: the folded initial of their key, or `#` outside A–Z. */
export function firstLetter(a: AuthorSummary): string {
  const initial = foldedInitial(sortKey(a));
  return isAlpha(initial) ? initial.toUpperCase() : "#";
}

/** A URL-fragment-safe slug for a letter: `#` would start a second fragment. */
export const letterFrag = (letter: string) =>
  letter === "#" ? "hash" : letter;

/** The row's name as [surname, given names]; a mononym has no given names. */
export function nameParts(a: AuthorSummary): [string, string] {
  const key = sortKey(a);
  const comma = key.indexOf(", ");
  return comma < 0 ? [key, ""] : [key.slice(0, comma), key.slice(comma + 2)];
}

/** `authors`, ordered; Recent puts the latest read first and the never-read after, by surname. */
export function sortAuthors(
  authors: AuthorSummary[],
  sort: AuthorSort,
  reading: ReadingMap | null,
): AuthorSummary[] {
  const folds = new Map<string, string>();
  const fold = (text: string) => {
    const known = folds.get(text);
    if (known !== undefined) return known;
    const key = dictionaryKey(text);
    folds.set(text, key);
    return key;
  };
  const rows = authors.map((author) => {
    const key = sortKey(author);
    return { author, key, alpha: isAlpha(foldedInitial(key)) };
  });
  type Row = (typeof rows)[number];
  // Non-alpha keys trail the alphabet under `#`, as their letter does.
  const byName = (a: Row, b: Row) =>
    Number(!a.alpha) - Number(!b.alpha) || dictionaryCmp(a.key, b.key, fold);
  const lastRead = (row: Row) => reading?.get(row.author.id)?.lastReadAt ?? -1;
  const order = {
    name: byName,
    book_count: (a: Row, b: Row) =>
      b.author.bookCount - a.author.bookCount || byName(a, b),
    recent: (a: Row, b: Row) => lastRead(b) - lastRead(a) || byName(a, b),
  } satisfies Record<AuthorSort, (a: Row, b: Row) => number>;
  return rows.sort(order[sort]).map((row) => row.author);
}

export type AuthorGroups = {
  filtered: AuthorSummary[];
  /** The same rows bucketed by surname letter under the Surname sort, else empty. */
  letters: [string, AuthorSummary[]][];
};

export type ListQuery = {
  text: string;
  sort: AuthorSort;
  /** `null` until the reader's progress loads (or if it fails to). */
  reading: ReadingMap | null;
  /** Keep only authors with a book in progress; ignored without `reading`. */
  onlyReading: boolean;
};

/** Filter, sort and group by letter in one step. */
export function computeAuthorGroups(
  all: AuthorSummary[],
  { text, sort, reading, onlyReading }: ListQuery,
): AuthorGroups {
  const query = foldForMatch(text);
  let rows = query
    ? all.filter((a) => foldForMatch(a.name).includes(query))
    : all;
  if (onlyReading && reading) {
    rows = rows.filter((a) => (reading.get(a.id)?.reading ?? 0) > 0);
  }
  const filtered = sortAuthors(rows, sort, reading);
  const letters: AuthorGroups["letters"] = [];
  if (sort === "name") {
    for (const a of filtered) {
      const letter = firstLetter(a);
      const last = letters.at(-1);
      if (last?.[0] === letter) last[1].push(a);
      else letters.push([letter, [a]]);
    }
  }
  return { filtered, letters };
}

/** Whoever the reader read most recently, else the first by surname; `null` for an empty library. */
export function defaultAuthor(
  all: AuthorSummary[],
  reading: ReadingMap | null,
): AuthorId | null {
  let best: { at: number; id: AuthorId } | null = null;
  for (const a of all) {
    const at = reading?.get(a.id)?.lastReadAt;
    if (at == null) continue;
    if (!best || at > best.at || (at === best.at && a.id > best.id)) {
      best = { at, id: a.id };
    }
  }
  return best?.id ?? sortAuthors(all, "name", null)[0]?.id ?? null;
}
