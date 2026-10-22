import type { BookReviews, MyReview, ReviewChange } from "../../api";

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
