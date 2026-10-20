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

type Rated = {
  stars: number | null;
  ratedAt: number | null;
  updatedAt: number;
};

/** The line beside your stars: a refused save first, then the rating and its age, else an invitation. */
export function starsMeta(
  now: number,
  failed: boolean,
  review: Rated | null | undefined,
): string {
  if (failed) return "Couldn’t save your rating — try again";
  if (review?.stars == null) return "Not rated yet";
  return `rated ${ago(now, review.ratedAt ?? review.updatedAt)} · ${fmtStars(review.stars)} of 5`;
}
