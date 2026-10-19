import type { RatingRecord } from "../../api";
import { fmtStars } from "../../components/StarRating/stars";
import { ago } from "../../format";

/** The label of a half-star button; the current value's own half announces that it clears. */
export function halfStarLabel(
  value: number,
  current: number | undefined,
): string {
  if (value === current) return `Clear your ${fmtStars(value)}-star rating`;
  return value === 1 ? "Rate 1 star" : `Rate ${fmtStars(value)} stars`;
}

/** What clicking a half-star saves: the value, or `null` (clear) when it is already the rating. */
export const ratingAfterClick = (value: number, current: number | undefined) =>
  value === current ? null : value;

/** The line under the stars: an error, the saved rating's age and value, or the unrated placeholder. */
export function ratingMeta(
  failed: boolean,
  record: RatingRecord | null | undefined,
  now: number,
): string {
  if (failed) return "Couldn't save rating — try again";
  if (!record) return "Not rated yet";
  return `rated ${ago(now, record.updatedAt)} · ${fmtStars(record.stars)} of 5`;
}
