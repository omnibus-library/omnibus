import type { AuthorId, AuthorReading, AuthorSummary } from "../../api";
import {
  type BrowseSort,
  dictionaryCmp,
  dictionaryKey,
  foldForMatch,
  type Groups,
  groupByLetter,
  isNonAlphaKey,
  letterForKey,
} from "../../components/Browse/browseOrder";

export type AuthorSort = BrowseSort;

/** The reader's progress per author id, once it has loaded. */
export type ReadingMap = Map<number, AuthorReading>;

export const byAuthor = (rows: AuthorReading[]): ReadingMap =>
  new Map(rows.map((r) => [r.authorId, r]));

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

/** The letter an author files under: the folded initial of their key, or `#` outside A–Z. */
export const firstLetter = (a: AuthorSummary) => letterForKey(sortKey(a));

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
    return { author, key, alpha: !isNonAlphaKey(key) };
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
): Groups<AuthorSummary> {
  const query = foldForMatch(text);
  let rows = query
    ? all.filter((a) => foldForMatch(a.name).includes(query))
    : all;
  if (onlyReading && reading) {
    rows = rows.filter((a) => (reading.get(a.id)?.reading ?? 0) > 0);
  }
  const filtered = sortAuthors(rows, sort, reading);
  return {
    filtered,
    letters: sort === "name" ? groupByLetter(filtered, firstLetter) : [],
  };
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
