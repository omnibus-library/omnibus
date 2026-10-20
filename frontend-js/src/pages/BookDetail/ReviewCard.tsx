import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  type BookReviews,
  type BookUuid,
  deleteReview,
  type MyReview,
  saveReview,
} from "../../api";
import {
  ConfirmBody,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { PencilGlyph, TrashGlyph } from "../../components/Glyphs/Glyphs";
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

type Writes = ReturnType<typeof useReviewWrites>;

/** Your rendered text, then your private notes, marked as private; the spoiler flag is set in the composer, so read mode carries no marker of it. */
function MyReviewWriting({ mine }: { mine: MyReview }) {
  return (
    <>
      {mine.bodyMd !== null && (
        <RenderedMarkdown
          html={mine.bodyHtml}
          md={mine.bodyMd}
          className="bd-review-text"
          testId="my-review-text"
        />
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

/** The trash can's confirm modal: the delete lands only on success, and a refusal keeps the modal open with the reason. */
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

/** Your review card, always first: a head row with the pencil (write or edit) and the trash can (delete), the one-tap stars, then your text and private notes. */
export function ReviewCard({
  uuid,
  mine,
}: {
  uuid: BookUuid;
  mine: MyReview | null;
}) {
  // The last tap made: a refusal of it is told even when a later Save or delete
  // has taken the queue, whose own answer then puts the old stars back.
  const lastTap = useRef<ReviewWrite | null>(null);
  const [starsFailed, setStarsFailed] = useState(false);
  const save = useReviewWrites(uuid, (write) => {
    if (write === lastTap.current) setStarsFailed(true);
  });
  const [composing, setComposing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pick = (stars: number | null) => {
    const write = { stars };
    lastTap.current = write;
    setStarsFailed(false);
    save.mutate(write);
  };
  const hasWriting = mine?.bodyMd != null || mine?.notesMd != null;
  const writeLabel = hasWriting ? "Edit review" : "Write review";
  return (
    <section
      className="bd-review-mine"
      data-testid="my-review"
      aria-label="Your review"
    >
      <div className="bd-review-mine-head">
        <div className="label bd-review-mine-k">Your review</div>
        <div className="bd-review-tools">
          {/* An open editor already is what the pencil would open. */}
          {!composing && (
            <button
              type="button"
              className="bd-review-tool"
              data-testid="review-write"
              aria-label={writeLabel}
              title={writeLabel}
              onClick={() => setComposing(true)}
            >
              <PencilGlyph />
            </button>
          )}
          {mine && (
            <button
              type="button"
              className="bd-review-tool bd-review-tool-danger"
              data-testid="review-delete"
              aria-label="Delete review"
              title="Delete review"
              onClick={() => setConfirming(true)}
            >
              <TrashGlyph />
            </button>
          )}
        </div>
      </div>
      <div className="bd-review-starsline">
        <StarPicker stars={mine?.stars ?? null} onPick={pick} />
        <div
          className="mono bd-review-starsmeta"
          role="status"
          data-testid="review-stars-meta"
        >
          {starsMeta(nowSecs(), starsFailed, mine)}
        </div>
      </div>
      <div className="bd-review-mine-body">
        {mine && <MyReviewWriting mine={mine} />}
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
