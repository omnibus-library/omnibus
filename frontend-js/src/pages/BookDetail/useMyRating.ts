import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  type BookReviews,
  type BookUuid,
  deleteReview,
  saveReview,
} from "../../api";
import { nowSecs } from "../../format";
import { reviewsQuery, shelvesQuery } from "./queries";
import { movesStars, optimisticReviews, type ReviewWrite } from "./reviews";
import { useOptimisticSave } from "./useOptimisticSave";

// The stats page and the chart builder sum the stars; their queries are keyed under these.
const STATS_KEYS = [["stats"], ["stats-chart"]] as const;

/**
 * Every write to your review, through one queue so the server applies them in the order made.
 * A stars tap shows at once and reverts if refused; the composer's Save (text, notes and the
 * spoiler flag) and a delete wait for the server. Once the last write settles the reviews are
 * read again, which refreshes the summary and the other readers.
 */
function useReviewWrites(
  uuid: BookUuid,
  onFailure: (write: ReviewWrite) => void,
) {
  const client = useQueryClient();
  const { queryKey } = reviewsQuery(uuid);
  const cached = (): BookReviews =>
    client.getQueryData(queryKey) ?? { mine: null, others: [], summary: null };
  return useOptimisticSave(
    queryKey,
    async (write: ReviewWrite) => {
      const mine =
        write === "delete"
          ? await deleteReview(uuid).then(() => null)
          : await saveReview(uuid, write);
      return { ...cached(), mine };
    },
    {
      optimistic: (write) => optimisticReviews(cached(), write, nowSecs()),
      // A smart shelf may match on rating, and the stats pages sum the stars.
      alsoInvalidate: (write) =>
        movesStars(write) ? [...STATS_KEYS, shelvesQuery(uuid).queryKey] : [],
      onFailure,
    },
  );
}

export type MyRating = ReturnType<typeof useMyRating>;

/**
 * The one queue for writes to your review, and the state of the last stars tap. Call it once
 * per page and hand the result to every control that rates, so a tap in the hero and a Save in
 * the review queue behind each other.
 */
export function useMyRating(uuid: BookUuid) {
  // The last tap made: its refusal is told even when a later Save has taken the
  // mutation, whose answer then puts the server's stars back.
  const lastTap = useRef<ReviewWrite | null>(null);
  const [starsFailed, setStarsFailed] = useState(false);
  const save = useReviewWrites(uuid, (write) => {
    if (write === lastTap.current) setStarsFailed(true);
  });
  const pick = (stars: number | null) => {
    const write = { stars };
    lastTap.current = write;
    setStarsFailed(false);
    save.mutate(write);
  };
  // A delete that lands after a tap empties the review, and clears the message with it.
  const forgetTap = () => {
    lastTap.current = null;
    setStarsFailed(false);
  };
  return { save, pick, starsFailed, forgetTap };
}
