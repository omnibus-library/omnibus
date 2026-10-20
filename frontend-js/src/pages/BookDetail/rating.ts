import { fmtStars } from "../../components/StarRating/stars";
import { ago } from "../../format";

/** The label of a half-star button; the current value's own half announces that it clears. */
export function halfStarLabel(value: number, current: number | null): string {
  if (value === current) return `Clear your ${fmtStars(value)}-star rating`;
  return value === 1 ? "Rate 1 star" : `Rate ${fmtStars(value)} stars`;
}

/** What clicking a half-star saves: the value, or `null` (clear) when it is already the rating. */
export const ratingAfterClick = (value: number, current: number | null) =>
  value === current ? null : value;

type Rated = { stars: number | null; ratedAt: number | null };

/** The line under the stars: an error, when the stars were given and how many, or the unrated placeholder. */
export function ratingMeta(
  failed: boolean,
  review: Rated | null | undefined,
  now: number,
): string {
  if (failed) return "Couldn't save — try again";
  if (review?.stars == null) return "Not rated yet";
  const value = `${fmtStars(review.stars)} of 5`;
  return review.ratedAt === null
    ? value
    : `rated ${ago(now, review.ratedAt)} · ${value}`;
}
