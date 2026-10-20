import type {
  BookReviews,
  MyReview,
  OtherReview,
  ReviewChange,
  ReviewSummary,
} from "../../api";
import { fmtStars } from "../../components/StarRating/stars";

// Ports of the Dioxus page's helpers (`pages/book_detail/reviews/`), so both clients
// count, clip and word the section alike.

/** A write to your review: a change to some of its fields, or deleting all of it. */
export type ReviewWrite = ReviewChange | "delete";

/** Your review once a stars tap lands, drawn before the server answers; `null` once nothing is left. Text and the spoiler flag wait for the server. */
export function applyLocally(
  mine: MyReview | null,
  stars: number | null,
  now: number,
): MyReview | null {
  const next: MyReview = mine
    ? { ...mine }
    : {
        stars: null,
        bodyMd: null,
        bodyHtml: null,
        notesMd: null,
        notesHtml: null,
        spoiler: false,
        ratedAt: null,
        createdAt: now,
        updatedAt: now,
      };
  next.stars = stars;
  next.ratedAt = stars === null ? null : now;
  next.updatedAt = now;
  const empty =
    next.stars === null && next.bodyMd === null && next.notesMd === null;
  return empty ? null : next;
}

/** The cached reviews while `write` is in flight: a stars tap drawn at once; the composer's Save and a delete wait for the server. */
export function optimisticReviews(
  reviews: BookReviews,
  write: ReviewWrite,
  now: number,
): BookReviews {
  if (write === "delete" || write.stars === undefined) return reviews;
  return {
    ...reviews,
    mine: applyLocally(reviews.mine, write.stars, now),
  };
}

/** Whether `write` can move the household's numbers: the stars, which stats and smart shelves read too. */
export const movesStars = (write: ReviewWrite) =>
  write === "delete" || write.stars !== undefined;

const fieldChange = (seed: string, now: string) => {
  const blank = now.trim() === "";
  if (seed === now || (blank && seed.trim() === "")) return undefined;
  return blank ? null : now;
};

/**
 * What the composer's Save sends: only the fields that changed since it opened, so a stars
 * change made meanwhile survives. Blank text clears its field.
 */
export function textChange(
  seed: { bodyMd: string; notesMd: string },
  draft: { bodyMd: string; notesMd: string },
): ReviewChange {
  const bodyMd = fieldChange(seed.bodyMd, draft.bodyMd);
  const notesMd = fieldChange(seed.notesMd, draft.notesMd);
  return {
    ...(bodyMd !== undefined && { bodyMd }),
    ...(notesMd !== undefined && { notesMd }),
  };
}

/** What the composer opens with: your saved text and notes, as Markdown, and your spoiler flag. */
export type ComposerSeed = {
  bodyMd: string;
  notesMd: string;
  spoiler: boolean;
};

/** The seed for `mine`, empty where nothing is written. */
export const composerSeed = (mine: MyReview | null): ComposerSeed => ({
  bodyMd: mine?.bodyMd ?? "",
  notesMd: mine?.notesMd ?? "",
  spoiler: mine?.spoiler ?? false,
});

/** What Save sends: the changed text fields, plus the spoiler flag only when it moved; empty when nothing changed. */
export function saveChange(
  seed: ComposerSeed,
  draft: ComposerSeed,
): ReviewChange {
  return {
    ...textChange(seed, draft),
    ...(draft.spoiler !== seed.spoiler && { spoiler: draft.spoiler }),
  };
}

export const isNoChange = (change: ReviewChange) =>
  Object.keys(change).length === 0;

/** Other readers split as the stop draws them: reviews with text, then the ratings without, each in the server's order. */
export function splitOthers(others: readonly OtherReview[]) {
  return {
    texts: others.filter((r) => r.bodyMd !== null),
    ratings: others.filter((r) => r.bodyMd === null),
  };
}

/** Whether a review's text stays behind its spoiler veil: marked, you haven't finished the book, and not yet revealed. */
export const spoilerVeiled = (
  spoiler: boolean,
  viewerFinished: boolean,
  revealed: boolean,
) => spoiler && !viewerFinished && !revealed;

const CLAMP_CHARS = 420;
const CLAMP_LINES = 6;

/** Whether a review's text is long enough, in characters or lines, to open clipped behind Read more. */
export function needsReadMore(md: string): boolean {
  const text = md.trim();
  return (
    [...text].length > CLAMP_CHARS || text.split(/\r?\n/).length > CLAMP_LINES
  );
}

/** `1 review`, `3 ratings`. */
export const countLabel = (n: number, noun: string) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The stop's kicker, `2 reviews · 3 ratings`, counting yours: reviews have text, ratings have stars, notes count for neither. */
export function reviewsKicker({ mine, others }: BookReviews): string {
  const texts =
    others.filter((r) => r.bodyMd !== null).length +
    (mine?.bodyMd != null ? 1 : 0);
  const rated =
    others.filter((r) => r.stars !== null).length +
    (mine?.stars != null ? 1 : 0);
  if (texts + rated === 0) return "No reviews yet";
  return `${countLabel(texts, "review")} · ${countLabel(rated, "rating")}`;
}

/** An average in stars to one decimal, a half rounding up: `4.3`, `4.0`. */
export const averageLabel = (stars: number) =>
  (Math.round(stars * 10) / 10).toFixed(1);

/** The title area's household rating, for a screen reader: "Rated 4.3 by 3 readers — go to the reviews". */
export const jumpLabel = (summary: ReviewSummary) =>
  `Rated ${averageLabel(summary.average)} by ${countLabel(summary.ratings, "reader")} — go to the reviews`;

/** Half stars as stars: 9 is `4.5`, 8 is `4`. */
const starsOf = (halfStars: number) => fmtStars(halfStars / 2);

/** One column of the household's spread. */
export type SpreadBar = {
  halfStars: number;
  readers: number;
  /** Height against the fullest bucket, 0 to 100. */
  heightPct: number;
  /** Whole stars only; the half columns between them go unlabelled. */
  label: string;
  title: string;
};

/** The ten buckets as bars scaled to the fullest one, a half percent rounding up. */
export function spreadBars(buckets: ReviewSummary["buckets"]): SpreadBar[] {
  const max = Math.max(1, ...buckets.map((b) => b.readers));
  return buckets.map(({ halfStars, readers }) => {
    const n = Math.max(readers, 0);
    return {
      halfStars,
      readers: n,
      heightPct: Math.min(
        100,
        Math.floor((n * 100 + Math.floor(max / 2)) / max),
      ),
      label: halfStars % 2 === 0 ? String(halfStars / 2) : "",
      title: `${starsOf(halfStars)} ★ · ${countLabel(readers, "reader")}`,
    };
  });
}

/** The spread's text alternative, each value someone gave, lowest first. */
export function spreadSummary(buckets: ReviewSummary["buckets"]): string {
  const given = buckets
    .filter((b) => b.readers > 0)
    .map(
      (b) => `${countLabel(b.readers, "reader")} at ${starsOf(b.halfStars)}`,
    );
  return given.length === 0
    ? "Ratings by stars: none."
    : `Ratings by stars: ${given.join(", ")}.`;
}
