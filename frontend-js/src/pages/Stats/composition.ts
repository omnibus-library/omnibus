import type { LibraryComposition } from "../../api";
import { bookCount } from "../../format";
import { sliceVar } from "./donut";
import { groupThousands } from "./summary";

type Dimension = LibraryComposition["formats"];

/** One dimension: its heading, its bars, and the line beneath them that says what the bars can't speak for. */
export type Panel = {
  title: string;
  testId: string;
  slices: Dimension["slices"];
  note: string | null;
  /** What it says when no book carries the dimension. */
  empty: string;
};

/** A bar's width as a percent of the dimension's largest slice: scaled to the tallest rather than the library total, or one dominant bucket would shrink every other bar to a few pixels. */
export const barWidth = (books: number, max: number) =>
  max <= 0 ? 0 : Math.min(Math.max(Math.trunc((books * 100) / max), 0), 100);

/** "across 1,204 of 1,510 books": a distribution without its coverage is a guess wearing a chart. */
export const coverageNote = (dim: Dimension, libraryBooks: number) =>
  `across ${groupThousands(dim.coverage.books)} of ${groupThousands(libraryBooks)} books`;

/** How many books the format bars count twice, or the bars don't add up to the library and a reader can't tell double-counting from a missing bucket. */
export function overlapNote(dim: Dimension): string | null {
  const overlap = Math.max(dim.coverage.total - dim.coverage.books, 0);
  return overlap === 0
    ? null
    : `+${bookCount(overlap)} held in more than one format`;
}

/** Books with no file on disk carry no format, so they'd vanish from the format bars and leave the counts not reconciling; worded for rows that never had files too. */
export const ghostedNote = (ghosted: number) =>
  ghosted === 0
    ? null
    : `${bookCount(ghosted)} excluded — no files on disk (paper copies, wishlist entries, removed files)`;

/** The five panels in the order they read: what the files are, then what the books are. */
export function buildPanels(c: LibraryComposition): Panel[] {
  return [
    {
      title: "Formats",
      testId: "stats-composition-formats",
      slices: c.formats.slices,
      // Coverage is always the whole library here, as a live book has a file by definition, so the overlap is the useful disclosure.
      note: overlapNote(c.formats),
      empty: "No files indexed yet.",
    },
    {
      title: "Languages",
      testId: "stats-composition-languages",
      slices: c.languages.slices,
      note: coverageNote(c.languages, c.books),
      empty: "No language metadata yet.",
    },
    {
      title: "Publishers",
      testId: "stats-composition-publishers",
      slices: c.publishers.slices,
      note: coverageNote(c.publishers, c.books),
      empty: "No publisher metadata yet.",
    },
    {
      title: "Published",
      testId: "stats-composition-decades",
      slices: c.decades.slices,
      // The uncovered books have an absent or unparseable date: unknown, never bucketed into a decade they'd share with real dates.
      note: coverageNote(c.decades, c.books),
      empty: "No publication dates yet.",
    },
    {
      title: "Genres",
      testId: "stats-composition-genres",
      slices: c.genres.slices,
      note: `hand-assigned — ${coverageNote(c.genres, c.books)}`,
      empty: "No genres assigned yet.",
    },
  ];
}

const dimensionEmpty = (dim: Dimension) =>
  dim.coverage.books === 0 || dim.slices.length === 0;

/** Whether the library has nothing to describe: no live books, or no dimension carrying one. Render nothing rather than five empty charts. */
export const isEmptyComposition = (c: LibraryComposition) =>
  c.books === 0 ||
  [c.formats, c.languages, c.publishers, c.decades, c.genres].every(
    dimensionEmpty,
  );

/** The bar colour for a slice: the donut ramp clamped at its faintest step rather than cycled, so a fifth row doesn't repeat the leader's accent and imply it ranks with the first. */
export const sliceColor = (index: number) => sliceVar(Math.min(index, 3));
