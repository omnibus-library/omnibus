import type {
  BookReviews,
  MyReview,
  OtherReview,
  ReadStatusValue,
  ReviewChange,
  ReviewSummary,
} from "../../api";
import { fmtStars } from "../../components/StarRating/stars";
import { fixed, plural } from "../../format";

/** A write to your review: a change to some of its fields, or deleting all of it. */
export type ReviewWrite = ReviewChange | "delete";

const textOrNull = (md: string | null) => (md?.trim() ? md : null);

const NO_REVIEW: Omit<MyReview, "createdAt" | "updatedAt"> = {
  stars: null,
  bodyMd: null,
  bodyHtml: null,
  notesMd: null,
  notesHtml: null,
  spoiler: false,
  ratedAt: null,
};

/**
 * Your review as it stands once `change` lands, for the card to show before the server answers;
 * `null` once nothing is left. Changed text has no rendering yet, so it shows as written.
 */
export function withChange(
  mine: MyReview | null,
  change: ReviewChange,
  now: number,
): MyReview | null {
  const next = mine
    ? { ...mine }
    : { ...NO_REVIEW, createdAt: now, updatedAt: now };
  if (change.stars !== undefined) {
    next.stars = change.stars;
    next.ratedAt = change.stars === null ? null : now;
  }
  if (change.bodyMd !== undefined) {
    const md = textOrNull(change.bodyMd);
    if (md !== next.bodyMd) next.bodyHtml = null;
    next.bodyMd = md;
  }
  if (change.notesMd !== undefined) {
    const md = textOrNull(change.notesMd);
    if (md !== next.notesMd) next.notesHtml = null;
    next.notesMd = md;
  }
  if (change.spoiler !== undefined) next.spoiler = change.spoiler;
  const empty =
    next.stars === null && next.bodyMd === null && next.notesMd === null;
  return empty ? null : next;
}

/** The cached reviews after `write`, as shown while it is in flight; a delete waits for the server. */
export function optimisticReviews(
  reviews: BookReviews,
  write: ReviewWrite,
  now: number,
): BookReviews {
  if (write === "delete") return reviews;
  return { ...reviews, mine: withChange(reviews.mine, write, now) };
}

/** Whether `write` can move the household's numbers: the stars, which stats and smart shelves read too. */
export const movesStars = (write: ReviewWrite) =>
  write === "delete" || write.stars !== undefined;

export type ReviewDraft = { bodyMd: string; notesMd: string; spoiler: boolean };

/**
 * The fields the editor changed against the saved review, and nothing else, so a Save never
 * rewrites what it didn't touch. The spoiler flag only means something beside text, so
 * clearing the text clears it too.
 */
export function draftChange(
  mine: MyReview | null,
  draft: ReviewDraft,
): ReviewChange {
  const body = textOrNull(draft.bodyMd);
  const notes = textOrNull(draft.notesMd);
  const spoiler = body !== null && draft.spoiler;
  return {
    ...(body !== (mine?.bodyMd ?? null) && { bodyMd: body }),
    ...(notes !== (mine?.notesMd ?? null) && { notesMd: notes }),
    ...(spoiler !== (mine?.spoiler ?? false) && { spoiler }),
  };
}

export const isNoChange = (change: ReviewChange) =>
  Object.keys(change).length === 0;

/** Other readers split as the stop draws them: reviews with text, then one row of bare ratings. */
export function splitOthers(others: readonly OtherReview[]) {
  return {
    written: others.filter((r) => r.bodyMd !== null),
    ratedOnly: others.filter((r) => r.bodyMd === null && r.stars !== null),
  };
}

/** Whether a review's text starts behind the spoiler cover: it is marked, and the viewer hasn't finished the book. */
export const startsCovered = (
  review: Pick<OtherReview, "spoiler">,
  viewerStatus: ReadStatusValue | null | undefined,
) => review.spoiler && viewerStatus !== "finished";

const readers = (n: number) => `${n} reader${plural(n)}`;

/** The household's rating in a line, "★ 4.3 · 3 readers". */
export const householdLine = (summary: ReviewSummary) =>
  `★ ${fixed(summary.average, 1)} · ${readers(summary.ratings)}`;

/** The same, for a screen reader: "Rated 4.3 out of 5 on average by 3 readers". */
export const householdLabel = (summary: ReviewSummary) =>
  `Rated ${fixed(summary.average, 1)} out of 5 on average by ${readers(summary.ratings)}`;

/** One column of the household's spread. */
export type SpreadBar = {
  label: string;
  readers: number;
  heightPct: number;
  title: string;
};

/** The ten half-star buckets as columns scaled to the fullest; an empty one stays a slot. */
export function spreadBars(buckets: ReviewSummary["buckets"]): SpreadBar[] {
  const max = Math.max(0, ...buckets.map((b) => b.readers));
  return buckets.map(({ halfStars, readers: n }) => {
    const label = fmtStars(halfStars / 2);
    return {
      label,
      readers: n,
      heightPct: max > 0 ? Math.round((Math.max(n, 0) / max) * 100) : 0,
      title: `${label} ★ · ${readers(n)}`,
    };
  });
}

/** The spread as a sentence, "1 reader gave 3.5 stars, 2 gave 5 stars", for the chart's label. */
export function spreadLabel(buckets: ReviewSummary["buckets"]): string {
  const given = buckets.filter((b) => b.readers > 0);
  if (given.length === 0) return "No star ratings yet";
  return given
    .map(({ halfStars, readers: n }, i) => {
      const who = i === 0 ? readers(n) : String(n);
      const stars = halfStars / 2;
      return `${who} gave ${fmtStars(stars)} star${plural(stars)}`;
    })
    .join(", ");
}

/** The stop's kicker: how many readers have rated or reviewed the book, yourself included. */
export function reviewsKicker({ mine, others }: BookReviews): string {
  const yours = mine && (mine.stars !== null || mine.bodyMd !== null) ? 1 : 0;
  const voices = others.length + yours;
  if (voices === 0) return "No reviews yet";
  const written =
    others.filter((r) => r.bodyMd !== null).length +
    (mine?.bodyMd != null ? 1 : 0);
  const tail = written > 0 ? ` · ${written} with a review` : "";
  return `${readers(voices)}${tail}`;
}
