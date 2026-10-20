import type { BookUuid, UserId } from "./core";
import { ok, send } from "./core";
import {
  getBookReviews,
  getDeleteReviewUrl,
  getPatchReviewUrl,
} from "./generated/omnibus";
import type {
  AttributedReview as AttributedReviewWire,
  BookReviewsOutput as BookReviewsWire,
  ReviewPatch,
  Review as ReviewWire,
  ReviewSummary as SummaryWire,
} from "./generated/schemas";
import { Review as ReviewSchema } from "./generated/schemas";

/** The screen's shape of the reader's own review, private notes included. */
export function toReview(wire: ReviewWire) {
  return {
    stars: wire.stars ?? null,
    bodyMd: wire.body_md ?? null,
    bodyHtml: wire.body_html ?? null,
    notesMd: wire.notes_md ?? null,
    notesHtml: wire.notes_html ?? null,
    spoiler: wire.spoiler,
    ratedAt: wire.rated_at ?? null,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

export type MyReview = ReturnType<typeof toReview>;

/** Another reader's review: who wrote it, their stars and public text, never their notes. */
function toOtherReview(wire: AttributedReviewWire) {
  return {
    reader: {
      id: wire.user_id as UserId,
      name: wire.username,
      hasAvatar: wire.has_avatar ?? false,
    },
    stars: wire.stars ?? null,
    bodyMd: wire.body_md ?? null,
    bodyHtml: wire.body_html ?? null,
    spoiler: wire.spoiler,
    ratedAt: wire.rated_at ?? null,
    createdAt: wire.created_at,
  };
}

export type OtherReview = ReturnType<typeof toOtherReview>;

function toSummary(wire: SummaryWire) {
  return {
    average: wire.average_stars,
    ratings: wire.ratings,
    buckets: wire.buckets.map((b) => ({
      halfStars: b.half_stars,
      readers: b.readers,
    })),
  };
}

export type ReviewSummary = ReturnType<typeof toSummary>;

/** The screen's shape of `GET /api/reviews/{uuid}`; `summary` is `null` until the server has one to give. */
export function toBookReviews(wire: BookReviewsWire) {
  return {
    mine: wire.mine ? toReview(wire.mine) : null,
    others: wire.others.map(toOtherReview),
    summary: wire.summary ? toSummary(wire.summary) : null,
  };
}

export type BookReviews = ReturnType<typeof toBookReviews>;

/** Your review, everyone else's, and the household's stars summed up. */
export async function fetchReviews(uuid: BookUuid): Promise<BookReviews> {
  return toBookReviews(ok(await getBookReviews(encodeURIComponent(uuid))));
}

/**
 * The fields of your review to change: one left out stays as it is, `null`
 * clears it. Text is Markdown; blank text counts as cleared.
 */
export type ReviewChange = {
  stars?: number | null;
  bodyMd?: string | null;
  notesMd?: string | null;
  spoiler?: boolean;
};

/** The merge-patch body for `change`: only the fields it names, blank text sent as `null`. */
export function toReviewPatch(change: ReviewChange): ReviewPatch {
  const text = (md: string | null) => (md?.trim() ? md : null);
  return {
    ...(change.stars !== undefined && { stars: change.stars }),
    ...(change.bodyMd !== undefined && { body_md: text(change.bodyMd) }),
    ...(change.notesMd !== undefined && { notes_md: text(change.notesMd) }),
    ...(change.spoiler !== undefined && { spoiler: change.spoiler }),
  };
}

/** Changes your review; `null` means the change left it empty, and the server deleted it. */
export async function saveReview(
  uuid: BookUuid,
  change: ReviewChange,
): Promise<MyReview | null> {
  // The generated fetcher has no validator for a nullable 200, and would JSON-parse an error's plain text.
  const res = await send(
    getPatchReviewUrl(encodeURIComponent(uuid)),
    "PATCH",
    toReviewPatch(change),
  );
  const saved = ReviewSchema.nullable().parse(await res.json());
  return saved && toReview(saved);
}

/** Removes your stars, text and notes together. */
export async function deleteReview(uuid: BookUuid): Promise<void> {
  await send(getDeleteReviewUrl(encodeURIComponent(uuid)), "DELETE");
}
