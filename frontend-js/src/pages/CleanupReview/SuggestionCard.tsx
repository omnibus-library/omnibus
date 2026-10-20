import type { SuggestionCard } from "../../api";
import { Button } from "../../components/Button/Button";
import { bookCount } from "../../format";
import {
  actionSentence,
  decideNote,
  editedValue,
  isEditable,
  proposedLabel,
  scannedLabel,
} from "./review";
import "../../components/Chip/Chip.css";
import "./CleanupReview.css";

/** The value being replaced; a merge names every record it folds away. */
function ScannedValue({ card }: { card: SuggestionCard }) {
  if (card.action === "merge") {
    return (
      <ul className="crx-merge-list" data-testid="cleanup-card-scanned">
        {(card.source_names ?? []).map((name) => (
          <li key={name} className="crx-merge-row">
            <span className="crx-merge-name crx-strike">{name}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="crx-current crx-strike" data-testid="cleanup-card-scanned">
      {card.primary_name}
    </div>
  );
}

/** The proposed value: an input the reviewer owns for a book-title rename, a static box for every other kind. */
function ProposedValue({
  card,
  draft,
  onDraft,
  onCommit,
}: {
  card: SuggestionCard;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: () => void;
}) {
  if (card.action === "split") {
    return (
      <div className="crx-parts" data-testid="cleanup-card-proposed">
        {(card.proposed_parts ?? []).map((part) => (
          <span key={part} className="chip crx-part">
            {part}
          </span>
        ))}
      </div>
    );
  }
  if (!isEditable(card)) {
    return (
      <div
        className="crx-proposed crx-proposed-static"
        data-testid="cleanup-card-proposed"
      >
        {draft}
      </div>
    );
  }
  return (
    <input
      className="crx-proposed"
      data-testid="cleanup-proposed-input"
      aria-label="Proposed title"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      value={draft}
      onChange={(e) => onDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
      }}
    />
  );
}

function hintLead(card: SuggestionCard): string {
  if (card.action === "delete") {
    return "Nothing replaces it — accepting removes the record and blocklists the name — ";
  }
  return isEditable(card)
    ? "Type over the proposal to accept your own wording — "
    : "Editing the proposal isn't wired up for this kind yet — ";
}

/** One suggestion: the action sentence, the scanned value struck through, and what would replace it. */
export function SuggestionCardView({
  card,
  draft,
  onDraft,
  onCommit,
}: {
  card: SuggestionCard;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <section className="card crx-card" data-testid="cleanup-card">
      <p className="crx-action-line" data-testid="cleanup-card-action">
        {actionSentence(card.kind, card.action)}
        <span className="crx-detected mono" data-testid="cleanup-card-books">
          {bookCount(card.book_count)} affected
        </span>
      </p>
      {card.action === "delete" ? (
        // Nothing replaces a deleted record, so there is no proposed side to draw.
        <div className="crx-proposal crx-proposal-solo">
          <span className="crx-side-label">{scannedLabel(card.action)}</span>
          <ScannedValue card={card} />
        </div>
      ) : (
        <div className="crx-proposal">
          <div>
            <span className="crx-side-label">{scannedLabel(card.action)}</span>
            <ScannedValue card={card} />
          </div>
          <div className="crx-arrow" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </div>
          <div className="crx-proposed-wrap">
            <span className="crx-side-label">
              {proposedLabel(card.action)}
              {editedValue(card, draft) !== null && (
                <span
                  className="crx-edited-tag"
                  data-testid="cleanup-edited-tag"
                >
                  edited
                </span>
              )}
            </span>
            <ProposedValue
              card={card}
              draft={draft}
              onDraft={onDraft}
              onCommit={onCommit}
            />
          </div>
        </div>
      )}
      {card.photo_url != null && (
        <img
          className="cleanup-card-photo"
          src={card.photo_url}
          // biome-ignore lint/a11y/noRedundantAlt: the alt text is the Dioxus page's
          alt={`Photo of ${card.primary_name}`}
          data-testid="cleanup-card-photo"
        />
      )}
      <p className="crx-hint" data-testid="cleanup-hint">
        {hintLead(card)}
        <kbd>Y</kbd>
        {" accepts, "}
        <kbd>N</kbd>
        {" rejects, "}
        <kbd>Space</kbd>
        {" skips it for this pass."}
      </p>
    </section>
  );
}

/** Accept, Reject and Skip, with a note on what accepting writes. */
export function DecideBar({
  edited,
  editable,
  inFlight,
  onAccept,
  onReject,
  onSkip,
}: {
  edited: boolean;
  editable: boolean;
  inFlight: boolean;
  onAccept: () => void;
  onReject: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="crx-decide" data-testid="cleanup-review-actions">
      <Button
        variant="primary"
        data-testid="cleanup-accept"
        disabled={inFlight}
        onClick={onAccept}
      >
        {edited ? "Accept edited title (Y)" : "Accept (Y)"}
      </Button>
      <Button
        data-testid="cleanup-reject"
        disabled={inFlight}
        onClick={onReject}
      >
        Reject (N)
      </Button>
      <Button
        variant="ghost"
        data-testid="cleanup-skip"
        disabled={inFlight}
        onClick={onSkip}
      >
        Skip (Space)
      </Button>
      <span className="crx-decide-spacer" />
      <span className="crx-decide-note mono" data-testid="cleanup-decide-note">
        {decideNote(edited, editable)}
      </span>
    </div>
  );
}
