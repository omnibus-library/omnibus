import { useEffect, useRef, useState } from "react";
import type { BookUuid, MyReview } from "../../api";
import {
  ConfirmBody,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { PencilGlyph, TrashGlyph } from "../../components/Glyphs/Glyphs";
import { nowSecs } from "../../format";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { ReviewComposer } from "./ReviewComposer";
import { starsMeta } from "./rating";
import { StarPicker } from "./StarPicker";
import type { MyRating } from "./useMyRating";

type Writes = MyRating["save"];

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
  onDeleted,
  onClose,
}: {
  save: Writes;
  /** Called once the server has taken the delete, before the modal closes. */
  onDeleted: () => void;
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
      onDeleted();
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
  rating,
}: {
  uuid: BookUuid;
  mine: MyReview | null;
  /** The page's one queue of writes to your review, shared with the hero's stars. */
  rating: MyRating;
}) {
  const { save, pick, starsFailed, forgetTap } = rating;
  const [composing, setComposing] = useState(false);
  // The pencil unmounts while the editor is open, so the editor's own close can't
  // hand focus back to it; the card does, once it is mounted again.
  const pencil = useRef<HTMLButtonElement>(null);
  const refocusPencil = useRef(false);
  const closeComposer = () => {
    refocusPencil.current = true;
    setComposing(false);
  };
  useEffect(() => {
    if (composing || !refocusPencil.current) return;
    refocusPencil.current = false;
    pencil.current?.focus();
  }, [composing]);
  const [confirming, setConfirming] = useState(false);
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
              ref={pencil}
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
        <StarPicker
          stars={mine?.stars ?? null}
          onPick={pick}
          note={starsMeta(nowSecs(), starsFailed, mine)}
        />
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
          onDismiss={closeComposer}
          focusOnOpen
        >
          <ReviewComposer
            uuid={uuid}
            mine={mine}
            onSave={(change) => save.mutateAsync(change)}
            onClose={closeComposer}
          />
        </ConfirmModal>
      )}
      {confirming && (
        <DeleteReviewModal
          save={save}
          onDeleted={forgetTap}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
