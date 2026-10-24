import type { SeriesSummary } from "../../api";
import type { DiscoveryPrefs } from "../../viewPrefs";

export type SeriesSort = DiscoveryPrefs["series_sort"];

/** What a series sorts under: its own sort name, else its name without a leading "The ". */
export function seriesSortKey(s: Pick<SeriesSummary, "name" | "sort">): string {
  if (s.sort) return s.sort;
  return s.name.replace(/^[Tt]he /, "");
}

// Code-unit order on the lowercased key, as the Dioxus index sorts.
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The series whose name or primary author contains `query`, in the order `sort` names. */
export function filterAndSortSeries(
  items: readonly SeriesSummary[],
  query: string,
  sort: SeriesSort,
): SeriesSummary[] {
  const q = query.toLowerCase();
  const kept = items.filter(
    (s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.primaryAuthor?.toLowerCase().includes(q) ?? false),
  );
  const key = (s: SeriesSummary) => seriesSortKey(s).toLowerCase();
  return kept.sort((a, b) =>
    sort === "book_count"
      ? b.bookCount - a.bookCount || byKey(key(a), key(b))
      : byKey(key(a), key(b)),
  );
}

/** A name split before its last word, which the card sets in italics; one word is all "last". */
export function splitLastWord(name: string): [rest: string, last: string] {
  const at = name.lastIndexOf(" ");
  return at < 0 ? ["", name] : [name.slice(0, at), name.slice(at + 1)];
}
