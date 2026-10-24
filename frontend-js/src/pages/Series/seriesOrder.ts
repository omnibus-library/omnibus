import type { SeriesId, SeriesReading, SeriesSummary } from "../../api";
import {
  type BrowseSort,
  foldForMatch,
  type Groups,
  groupByLetter,
  letterForKey,
  sortRows,
} from "../../components/Browse/browseOrder";
import { bookCount } from "../../format";

export type SeriesSort = BrowseSort;

/** The reader's progress per series id, once it has loaded. */
export type ReadingMap = Map<number, SeriesReading>;

export const bySeries = (rows: SeriesReading[]): ReadingMap =>
  new Map(rows.map((r) => [r.seriesId, r]));

/** What a series files and sorts under: its own sort name, else its name without a leading "The ", so "The Expanse" files under E. */
export function seriesSortKey(s: Pick<SeriesSummary, "name" | "sort">): string {
  if (s.sort) return s.sort;
  return s.name.replace(/^[Tt]he /, "");
}

/** The letter a series files under: the folded initial of its key, or `#` outside A–Z. */
export const firstLetter = (s: SeriesSummary) => letterForKey(seriesSortKey(s));

/** `series`, ordered; Recent puts the latest read first and the never-read after, by name. */
function sortSeries(
  series: SeriesSummary[],
  sort: SeriesSort,
  reading: ReadingMap | null,
): SeriesSummary[] {
  return sortRows(series, sort, {
    key: seriesSortKey,
    count: (s) => s.bookCount,
    lastRead: (s) => reading?.get(s.id)?.lastReadAt ?? -1,
  });
}

export type ListQuery = {
  text: string;
  sort: SeriesSort;
  /** `null` until the reader's progress loads (or if it fails to). */
  reading: ReadingMap | null;
  /** Keep only series with a book in progress; ignored without `reading`. */
  onlyReading: boolean;
};

/** Filter by name or author, sort and group by letter in one step. */
export function computeSeriesGroups(
  all: SeriesSummary[],
  { text, sort, reading, onlyReading }: ListQuery,
): Groups<SeriesSummary> {
  const query = foldForMatch(text);
  const hit = (field: string | null) =>
    field !== null && foldForMatch(field).includes(query);
  let rows = query
    ? all.filter((s) => hit(s.name) || hit(s.primaryAuthor))
    : all;
  if (onlyReading && reading) {
    rows = rows.filter((s) => (reading.get(s.id)?.reading ?? 0) > 0);
  }
  const filtered = sortSeries(rows, sort, reading);
  return {
    filtered,
    letters: sort === "name" ? groupByLetter(filtered, firstLetter) : [],
  };
}

/** Whichever series the reader read most recently, else the first by name; `null` for an empty library. */
export function defaultSeries(
  all: SeriesSummary[],
  reading: ReadingMap | null,
): SeriesId | null {
  let best: { at: number; id: SeriesId } | null = null;
  for (const s of all) {
    const at = reading?.get(s.id)?.lastReadAt;
    if (at == null) continue;
    if (!best || at > best.at || (at === best.at && s.id > best.id)) {
      best = { at, id: s.id };
    }
  }
  return best?.id ?? sortSeries(all, "name", null)[0]?.id ?? null;
}

/** The row's accessible name, "Dune, by Frank Herbert, 6 books, 2 finished", each part dropped when unknown or zero. */
export function rowLabel(
  series: SeriesSummary,
  progress: SeriesReading | undefined,
): string {
  const finished = progress?.finished ?? 0;
  return [
    series.name,
    series.primaryAuthor === null ? null : `by ${series.primaryAuthor}`,
    bookCount(series.bookCount),
    finished > 0 ? `${finished} finished` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}
