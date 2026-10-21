import type { StatsSummary } from "../../api";
import { bookCount } from "../../format";

type GenreShare = StatsSummary["genre_share"][number];

/** Slices drawn before the rest fold into "Other". */
const DONUT_SLICES = 4;

/** Slice colour tokens, defined in Stats.css off `--accent` and `--bg-3`. */
const SLICE_VARS = [
  "var(--st-donut-c0)",
  "var(--st-donut-c1)",
  "var(--st-donut-c2)",
  "var(--st-donut-c3)",
  "var(--st-donut-other)",
] as const;

/** The token for slice `i`; anything past the last reuses the fold's. */
export const sliceVar = (i: number) =>
  SLICE_VARS[Math.min(i, SLICE_VARS.length - 1)];

/** The top shares plus an "Other" fold for the tail. */
export function foldShares(shares: readonly GenreShare[]): GenreShare[] {
  const folded = shares.slice(0, DONUT_SLICES);
  const rest = shares
    .slice(DONUT_SLICES)
    .reduce((books, share) => books + share.books, 0);
  return rest > 0 ? [...folded, { name: "Other", books: rest }] : folded;
}

/** Whole percentages that sum to exactly 100 (largest remainder), so the ring closes and the legend never reads 99% or 101%. */
export function percentages(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const slots = counts.map((count, index) => ({
    index,
    percent: Math.trunc((count * 100) / total),
    remainder: (count * 100) % total,
  }));
  const leftover = 100 - slots.reduce((sum, slot) => sum + slot.percent, 0);
  // Array#sort is stable, so equal remainders keep their order.
  const byRemainder = [...slots].sort((a, b) => b.remainder - a.remainder);
  for (const slot of byRemainder.slice(0, leftover)) slot.percent += 1;
  return slots.map((slot) => slot.percent);
}

/** The ring's `conic-gradient(...)` with cumulative stops, so a genre that rounds to nothing collapses to zero width rather than a hairline. */
export function donutGradient(percents: readonly number[]): string {
  let at = 0;
  const stops = percents.map((percent, i) => {
    const stop = `${sliceVar(i)} ${at}% ${at + percent}%`;
    at += percent;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/** The disclosure line for active books the ring can't describe. */
export const untaggedNote = (untagged: number) =>
  `+${bookCount(untagged)} without a genre`;
