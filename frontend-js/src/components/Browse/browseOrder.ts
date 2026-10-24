import type { DiscoveryPrefs } from "../../viewPrefs";

/** The sort axes every browse list offers; the first is the page's own name order. */
export type BrowseSort = DiscoveryPrefs["authors_sort"];

/** The visible rows in order, and the same rows bucketed by letter under the name sort (else empty). */
export type Groups<T> = {
  filtered: T[];
  letters: [string, T[]][];
};

/** Where a browse list stands; a failed refresh keeps its rows, so only a first load that fails is "failed". */
export type ListPhase = "loading" | "failed" | "empty" | "ready";

export function listPhase(list: {
  isPending: boolean;
  isError: boolean;
  hasRows: boolean;
}): ListPhase {
  if (list.isPending) return "loading";
  if (list.hasRows) return "ready";
  return list.isError ? "failed" : "empty";
}

/** Case and accents folded away, for matching typed text; mirrors `fold_for_match` in `shared/`. */
export function foldForMatch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

// Mirrors `dictionary_key` in `shared/src/sort_order.rs`: the comma files below every printable character.
export const dictionaryKey = (text: string) =>
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

const foldedInitial = (key: string) =>
  foldForMatch([...key][0] ?? "").charAt(0);

/** Whether `key` files under `#` rather than A–Z. */
export const isNonAlphaKey = (key: string) =>
  !/^[a-z]$/i.test(foldedInitial(key));

/** The letter a sort key files under: its folded initial, or `#` outside A–Z. */
export function letterForKey(key: string): string {
  return isNonAlphaKey(key) ? "#" : foldedInitial(key).toUpperCase();
}

/** A URL-fragment-safe slug for a letter: `#` would start a second fragment. */
export const letterFrag = (letter: string) =>
  letter === "#" ? "hash" : letter;

/** What a row sorts by: its filing key, its book count, and when the reader last read it (`-1` for never). */
export type RowOrder<T> = {
  key: (row: T) => string;
  count: (row: T) => number;
  lastRead: (row: T) => number;
};

/** `rows` ordered along `sort`; the non-alphabetic bucket trails the alphabet under `#`, as its letter does. */
export function sortRows<T>(
  rows: T[],
  sort: BrowseSort,
  { key, count, lastRead }: RowOrder<T>,
): T[] {
  const folds = new Map<string, string>();
  const fold = (text: string) => {
    const known = folds.get(text);
    if (known !== undefined) return known;
    const folded = dictionaryKey(text);
    folds.set(text, folded);
    return folded;
  };
  const keyed = rows.map((row) => {
    const k = key(row);
    return { row, key: k, alpha: !isNonAlphaKey(k) };
  });
  type Keyed = (typeof keyed)[number];
  const byName = (a: Keyed, b: Keyed) =>
    Number(!a.alpha) - Number(!b.alpha) || dictionaryCmp(a.key, b.key, fold);
  const order = {
    name: byName,
    book_count: (a: Keyed, b: Keyed) =>
      count(b.row) - count(a.row) || byName(a, b),
    recent: (a: Keyed, b: Keyed) =>
      lastRead(b.row) - lastRead(a.row) || byName(a, b),
  } satisfies Record<BrowseSort, (a: Keyed, b: Keyed) => number>;
  return keyed.sort(order[sort]).map((k) => k.row);
}

/** Buckets consecutive same-letter rows of an already-sorted list. */
export function groupByLetter<T>(
  sorted: T[],
  letter: (row: T) => string,
): [string, T[]][] {
  const letters: [string, T[]][] = [];
  for (const row of sorted) {
    const l = letter(row);
    const last = letters.at(-1);
    if (last?.[0] === l) last[1].push(row);
    else letters.push([l, [row]]);
  }
  return letters;
}
