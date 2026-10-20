import type { ChartResult, ChartUnit } from "../../api";
import { MAX_AXES, MEASURES } from "./chart";

// Written from the live result, so each note names the units, measures and genres actually on screen.

// The server folds the tail past this many genres into "Other", and clips past this many periods.
const BREAKDOWN_LIMIT = 5;
const OTHER_LABEL = "Other";
export const MAX_BUCKETS = 366;

/** Unit names as "books and pages" or "books, pages and minutes". */
export function joinUnits(units: readonly ChartUnit[]): string {
  const last = units.at(-1);
  if (last === undefined || units.length === 1) return last ?? "";
  return `${units.slice(0, -1).join(", ")} and ${last}`;
}

const unitsOf = (result: ChartResult) => result.axes.map((a) => a.unit);

/** How the y-scales are laid out. Two axes say outright that a crossing means nothing, which is the easiest thing on this chart to misread. */
export function scalesNote(result: ChartResult): string | null {
  const [left, right] = unitsOf(result);
  if (left === undefined) return null;
  if (right === undefined) {
    return `Everything here is measured in ${left}, so it all shares one scale and the heights are directly comparable.`;
  }
  return `Two units, so two scales — ${left} on the left, ${right} on the right. They are sized independently, so where one series crosses another means nothing.`;
}

/** Why the picker has closed off part of its list, when it has. */
export function availabilityNote(result: ChartResult): string {
  const units = unitsOf(result);
  if (units.length < MAX_AXES) {
    return "One scale is still free, so anything in the list can join.";
  }
  return `A chart can label two scales, and ${joinUnits(units)} have both. Anything else in those two units can still join; every other unit is greyed out until you clear a measure and free a scale.`;
}

/** What a split does to the marks, when one is on. */
export function splitNote(result: ChartResult): string | null {
  const slices = result.series.flatMap((s) => s.slice ?? []);
  if (slices.length === 0) return null;
  const tail = slices.includes(OTHER_LABEL)
    ? ` Only the ${BREAKDOWN_LIMIT} genres you read most get their own colour; the rest are folded into Other.`
    : "";
  return result.stacked
    ? `Split by genre, and the slices stack — each column is that period's total, cut up by genre.${tail}`
    : `Split by genre, side by side rather than stacked: these are averages, and averages don't add up into a total.${tail}`;
}

/** What dragging across the chart does, and its limit, so a zoom that won't subdivide doesn't look broken. */
export function zoomNote(result: ChartResult): string {
  const base = "Drag across the chart to zoom into a stretch of it.";
  return result.truncated
    ? `${base} It narrows the periods already loaded — it can't reach past the ones this axis had to clip, and it won't break a period into smaller ones.`
    : `${base} It narrows the periods already loaded rather than fetching finer ones, so zooming into three months shows three periods, not ninety days — change Group by for that.`;
}

/** What an empty bucket means, which differs by aggregate and is the other easy misreading. */
export function emptyNote(result: ChartResult): string | null {
  const averages = result.series.map(
    (s) => MEASURES[s.measure].aggregate === "average",
  );
  const hasAverage = averages.some(Boolean);
  const hasTotal = averages.some((isAverage) => !isAverage);
  if (hasAverage && hasTotal) {
    return "A quiet period reads as zero for the totals, but the averages go blank and the line breaks — you can't average nothing.";
  }
  return hasAverage
    ? "Where nothing was recorded the line breaks rather than dropping to zero — you can't average nothing."
    : null;
}
