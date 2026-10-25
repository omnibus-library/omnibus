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

/** The note beside the stars while the pointer rests on `value`; on the saved value itself a click clears. */
export const previewNote = (value: number, current: number | null) =>
  value === current ? "Clear your rating" : `Rate ${fmtStars(value)}`;

/** The note beside the hero's stars: your rating not yet known, a refused save, then what you rated it, else an invitation. */
export function heroRatingNote(
  failed: boolean,
  stars: number | null,
  read: "ready" | "loading" | "failed" = "ready",
): string {
  if (read === "loading") return "Loading your rating…";
  if (read === "failed") return "Couldn’t load your rating";
  if (failed) return "Couldn’t save your rating — try again";
  return stars === null ? "Not rated yet" : `You rated it ${fmtStars(stars)}`;
}

/** The half star an arrow key, Home or End moves to from `from`; `null` when the key does nothing there. */
export function halfAfterKey(from: number, key: string): number | null {
  const target: Record<string, number> = {
    ArrowRight: from + 0.5,
    ArrowUp: from + 0.5,
    ArrowLeft: from - 0.5,
    ArrowDown: from - 0.5,
    Home: 0.5,
    End: 5,
  };
  const to = target[key];
  return to === undefined || to === from || to < 0.5 || to > 5 ? null : to;
}

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

/** The household's mean rating and how many readers gave one; `null` while nobody has. */
export function householdRating(
  stars: (number | null)[],
): { average: number; count: number } | null {
  const given = stars.filter((s) => s !== null);
  if (given.length === 0) return null;
  const total = given.reduce((sum, s) => sum + s, 0);
  return { average: total / given.length, count: given.length };
}
