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
  ConfirmBody,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { nowSecs } from "../../format";
import { reviewsQuery, shelvesQuery } from "./queries";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { ReviewComposer } from "./ReviewComposer";
import { starsMeta } from "./rating";
import { movesStars, optimisticReviews, type ReviewWrite } from "./reviews";
import { StarPicker } from "./StarPicker";
import { useOptimisticSave } from "./useOptimisticSave";

// The stats page and the chart builder sum the stars; their queries are keyed under these.
const STATS_KEYS = [["stats"], ["stats-chart"]] as const;

/** Which of your quick writes the server last refused, so its own line can say so. */
type QuickWrite = "stars" | "spoiler";

/**
 * Every write to your review, through one queue so the server applies them in the order made.
 * Stars and the spoiler flag show at once and revert if refused; text and a delete wait for
 * the server. Once the last write settles the reviews are read again, which refreshes the
 * summary and the other readers.
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

type Writes = ReturnType<typeof useReviewWrites>;

/** Your rendered text with its spoiler checkbox, then your private notes, marked as private. */
function MyReviewWriting({
  mine,
  failed,
  onSpoiler,
}: {
  mine: MyReview;
  failed: boolean;
  onSpoiler: (spoiler: boolean) => void;
}) {
  return (
    <>
      {mine.bodyMd !== null && (
        <>
          <RenderedMarkdown
            html={mine.bodyHtml}
            md={mine.bodyMd}
            className="bd-review-text"
            testId="my-review-text"
          />
          <div className="bd-review-spoilerrow">
            <label className="bd-review-spoiler" data-testid="review-spoiler">
              <input
                type="checkbox"
                checked={mine.spoiler}
                onChange={(event) => onSpoiler(event.target.checked)}
              />
              Contains spoilers
            </label>
            {failed && (
              <span
                className="mono bd-journal-error"
                role="alert"
                data-testid="review-spoiler-error"
              >
                Couldn’t save — try again
              </span>
            )}
          </div>
        </>
      )}
      {mine.notesMd !== null && (
        <div className="bd-review-notes" data-testid="my-review-notes">
          <div className="mono bd-review-notes-k">
            <span aria-hidden="true">🔒 </span>
            Private notes · only you can see these
          </div>
          <RenderedMarkdown html={mine.notesHtml} md={mine.notesMd} />
        </div>
      )}
    </>
  );
}

/** Delete review's confirm modal: the delete lands only on success, and a refusal keeps the modal open with the reason. */
function DeleteReviewModal({
  save,
  onClose,
}: {
  save: Writes;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    // A double-click can land before the disabled state re-renders.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await save.mutateAsync("delete");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmModal
      testId="review-delete-modal"
      ariaLabel="Delete your review?"
      dialogClass="mg-modal confirm-modal"
      busy={busy}
      onDismiss={onClose}
      focusOnOpen
    >
      <ConfirmBody
        title="Delete your review?"
        body="This removes your stars, your review and your private notes for good. This can’t be undone."
        note={
          error && (
            <p
              className="mono bd-journal-error"
              role="alert"
              data-testid="review-delete-error"
            >
              {error}
            </p>
          )
        }
        actions={[
          {
            testId: "review-delete-cancel",
            label: "Cancel",
            tone: "ghost",
            disabled: busy,
            onClick: onClose,
          },
          {
            testId: "review-delete-confirm",
            label: "Delete",
            busyLabel: "Deleting…",
            busy,
            tone: "danger",
            disabled: busy,
            onClick: remove,
          },
        ]}
      />
    </ConfirmModal>
  );
}

/** Your review card, always first: one-tap stars, your text and private notes, Write / Edit and Delete review. */
export function ReviewCard({
  uuid,
  mine,
}: {
  uuid: BookUuid;
  mine: MyReview | null;
}) {
  const save = useReviewWrites(uuid);
  // Only the newest quick write's outcome is told, which is the one the card now shows.
  const [failure, setFailure] = useState<QuickWrite | null>(null);
  const [composing, setComposing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const quick = (kind: QuickWrite, write: ReviewWrite) => {
    setFailure(null);
    save.mutate(write, { onError: () => setFailure(kind) });
  };
  const hasWriting = mine?.bodyMd != null || mine?.notesMd != null;
  return (
    <section
      className="bd-review-mine"
      data-testid="my-review"
      aria-label="Your review"
    >
      <div className="label bd-review-mine-k">Your review</div>
      <div className="bd-review-starsline">
        <StarPicker
          stars={mine?.stars ?? null}
          onPick={(stars) => quick("stars", { stars })}
        />
        <div
          className="mono bd-review-starsmeta"
          role="status"
          data-testid="review-stars-meta"
        >
          {starsMeta(nowSecs(), failure === "stars", mine)}
        </div>
      </div>
      <div className="bd-review-mine-body">
        {mine && (
          <MyReviewWriting
            mine={mine}
            failed={failure === "spoiler"}
            onSpoiler={(spoiler) => quick("spoiler", { spoiler })}
          />
        )}
        <div className="bd-review-actions">
          <Button
            size="sm"
            data-testid="review-write"
            onClick={() => setComposing(true)}
          >
            {hasWriting ? "✎ Edit review" : "✎ Write review"}
          </Button>
          {mine && (
            <Button
              variant="ghost"
              size="sm"
              className="bd-journal-delete"
              data-testid="review-delete"
              onClick={() => setConfirming(true)}
            >
              Delete review
            </Button>
          )}
        </div>
      </div>
      {composing && (
        // Not dismissable by a click outside: a stray one must not throw away the draft.
        <ConfirmModal
          testId="review-composer-overlay"
          ariaLabel={hasWriting ? "Edit your review" : "Write review"}
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
        <DeleteReviewModal save={save} onClose={() => setConfirming(false)} />
      )}
    </section>
  );
}
