import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type BookReviews,
  type BookUuid,
  deleteReview,
  type MyReview,
  saveReview,
} from "../../api";
import { Button } from "../../components/Button/Button";
import {
  ConfirmDialog,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { nowSecs } from "../../format";
import { reviewsQuery, shelvesQuery } from "./queries";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { ReviewComposer } from "./ReviewComposer";
import { ratingMeta } from "./rating";
import { movesStars, optimisticReviews, type ReviewWrite } from "./reviews";
import { StarPicker } from "./StarPicker";
import { useOptimisticSave } from "./useOptimisticSave";

// The stats page and the chart builder sum the stars; their queries are keyed under these.
const STATS_KEYS = [["stats"], ["stats-chart"]] as const;

/**
 * Every write to your review, through one queue so the server applies them in the order made.
 * A stars or spoiler change shows at once and reverts if refused; a delete waits for the server.
 * Once the last write settles the reviews are read again, which refreshes the summary and others.
 */
function useReviewWrites(uuid: BookUuid) {
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
    },
  );
}

function PrivateNotes({ mine }: { mine: MyReview }) {
  if (mine.notesMd === null) return null;
  return (
    <div className="bd-review-notes" data-testid="review-notes">
      <div className="label bd-review-notes-head">
        <span aria-hidden="true">🔒</span> Private notes
        <span className="mono bd-review-field-hint">
          only you can see these
        </span>
      </div>
      <RenderedMarkdown html={mine.notesHtml} md={mine.notesMd} />
    </div>
  );
}

/** Your review: one-tap stars, your text and private notes, and Write / Edit / Delete. */
export function ReviewCard({
  uuid,
  mine,
}: {
  uuid: BookUuid;
  mine: MyReview | null;
}) {
  const save = useReviewWrites(uuid);
  // Only the newest tap's outcome is told, which is the one the stars now show.
  const [tapFailed, setTapFailed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const tap = (write: ReviewWrite) => {
    setTapFailed(false);
    save.mutate(write, {
      onSuccess: () => setTapFailed(false),
      onError: () => setTapFailed(true),
    });
  };
  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await save.mutateAsync("delete");
      setConfirming(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };
  const written = mine?.bodyMd != null || mine?.notesMd != null;
  return (
    <article className="card bd-review-mine" data-testid="review-mine">
      <div className="bd-review-mine-head">
        <div className="label">Your review</div>
        <span className="bdmq-headspacer" />
        {mine && (
          <Button
            variant="ghost"
            size="sm"
            className="bd-journal-delete"
            data-testid="review-delete"
            onClick={() => {
              setDeleteError(null);
              setConfirming(true);
            }}
          >
            Delete review
          </Button>
        )}
      </div>
      <StarPicker
        stars={mine?.stars ?? null}
        onPick={(stars) => tap({ stars })}
      />
      <div
        className="mono bd-rating-meta"
        role="status"
        data-testid="rating-meta"
      >
        {ratingMeta(tapFailed, mine, nowSecs())}
      </div>
      {mine?.bodyMd != null && (
        <>
          <RenderedMarkdown
            html={mine.bodyHtml}
            md={mine.bodyMd}
            className="bd-review-text"
            testId="review-mine-text"
          />
          <div className="bd-review-spoiler-check">
            <label className="bd-review-spoiler-label">
              <input
                type="checkbox"
                checked={mine.spoiler}
                data-testid="review-spoiler"
                onChange={(event) => tap({ spoiler: event.target.checked })}
              />
              <span>Contains spoilers</span>
            </label>
          </div>
        </>
      )}
      {mine && <PrivateNotes mine={mine} />}
      <div className="bd-review-mine-actions">
        <Button
          size="sm"
          data-testid="review-write"
          onClick={() => setComposing(true)}
        >
          {written ? "✎ Edit review" : "✎ Write a review"}
        </Button>
      </div>
      {composing && (
        // Not dismissable by a click outside: a stray one must not throw away the draft.
        <ConfirmModal
          testId="review-composer-overlay"
          ariaLabel={written ? "Edit your review" : "Write a review"}
          backdropClass="bdmq-overlay bdmq-overlay-static"
          dialogClass="bdmq-ocard bdmq-ocard-composer"
          busy
          onDismiss={() => setComposing(false)}
          focusOnOpen
        >
          <ReviewComposer
            uuid={uuid}
            mine={mine}
            onSave={(change) => save.mutateAsync(change)}
            onClose={() => setComposing(false)}
          />
        </ConfirmModal>
      )}
      {confirming && (
        <ConfirmDialog
          testId="review-delete-modal"
          title="Delete your review?"
          body="Your stars, your review and your private notes are removed for good. This can’t be undone."
          action="Delete review"
          busyLabel="Deleting…"
          busy={deleting}
          note={
            deleteError && (
              <p className="bd-merge-error" role="alert">
                {deleteError}
              </p>
            )
          }
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </article>
  );
}
