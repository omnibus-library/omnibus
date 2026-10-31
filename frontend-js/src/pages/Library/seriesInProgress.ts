import type { SeriesBook, SeriesInProgress } from "../../api";
import { tileBar } from "../../components/Browse/bookStates";
import {
  bookNumber,
  type NextAction,
  type NextUp,
  nextAction,
} from "../SeriesDetail/seriesProgress";

/** Most covers a row fans. */
const LEAVES = 3;

/** One series in progress as its row draws it. */
export type SeriesRow = {
  series: SeriesInProgress;
  next: SeriesBook;
  /** The covers fanned, the next book in front. */
  leaves: SeriesBook[];
  subtitle: string;
  /** Each book's fill, 0 to 100, in reading order. */
  segments: number[];
  finished: number;
  total: number;
  action: NextAction;
};

/** The row for `series`, or `null` when the book the server named is not among its books. */
export function seriesRow(series: SeriesInProgress): SeriesRow | null {
  const next = series.books.find((b) => b.uuid === series.nextUuid);
  if (!next) return null;
  const state = series.reading.get(next.uuid) ?? null;
  const target: NextUp =
    state?.status === "reading"
      ? { kind: "resume", book: next, state }
      : { kind: "start", book: next, state, fresh: false };
  const percent = state?.status === "reading" ? state.percent : null;
  return {
    series,
    next,
    leaves: [next, ...series.books.filter((b) => b !== next)].slice(0, LEAVES),
    subtitle: [
      "Up next",
      bookNumber(next),
      next.title,
      percent === null ? null : `${percent}%`,
    ]
      .filter((part) => part !== null)
      .join(" · "),
    segments: series.books.map((b) => tileBar(series.reading.get(b.uuid)) ?? 0),
    finished: series.books.filter(
      (b) => series.reading.get(b.uuid)?.status === "finished",
    ).length,
    total: series.books.length,
    action: nextAction(target),
  };
}
