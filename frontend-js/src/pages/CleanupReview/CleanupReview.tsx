import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useRef, useState } from "react";
import { useParams } from "react-router";
import {
  type CleanupKind,
  cleanupCountsQuery,
  cleanupQueueQuery,
  decideCleanup,
  parseCleanupKind,
  type SuggestionCard,
  undoCleanup,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { useCurrentUser } from "../../session";
import { ReviewFrame, ReviewRefusal } from "./ReviewFrame";
import {
  appliedSummary,
  editedValue,
  initialValue,
  isEditable,
  reviewKeyAction,
  type Tally,
  tallyRows,
} from "./review";
import { DecideBar, SuggestionCardView } from "./SuggestionCard";

const NOTHING_YET: Tally = {
  accepted: 0,
  acceptedEdited: 0,
  rejected: 0,
  skipped: 0,
  undone: 0,
};

/** What the undo bar shows: nothing yet, the last applied change, or a note that it was undone. */
type UndoState =
  | { state: "none" }
  | { state: "offer"; logId: number; summary: string }
  | { state: "undone" };

type Decision = {
  card: SuggestionCard;
  draft: string;
  decision: "accepted" | "rejected";
};

function UndoBar({
  undo,
  disabled,
  busy,
  onUndo,
}: {
  undo: UndoState;
  disabled: boolean;
  busy: boolean;
  onUndo: () => void;
}) {
  switch (undo.state) {
    case "none":
      return null;
    case "offer":
      return (
        <div className="crx-undo" data-testid="cleanup-undo-bar">
          <p role="status">{undo.summary}</p>
          <Button
            variant="ghost"
            size="sm"
            data-testid="cleanup-undo"
            disabled={disabled}
            aria-busy={busy}
            onClick={onUndo}
          >
            <BusyLabel busy={busy} label="Undo" busyLabel="Undoing…" />
          </Button>
        </div>
      );
    case "undone":
      return (
        <div className="crx-undo" data-testid="cleanup-undone">
          <p role="status">Change undone. The library is back as it was.</p>
        </div>
      );
    default: {
      const _exhaustive: never = undo;
      return _exhaustive;
    }
  }
}

/** The end of a pass: what this sitting did, and a note that the last change can be undone. */
function PassDone({ tally }: { tally: Tally }) {
  const rows = tallyRows(tally);
  return (
    <section
      className="card crx-card crx-card-done"
      data-testid="cleanup-card-done"
    >
      <p
        className="settings-status"
        role="status"
        data-testid="cleanup-review-empty"
      >
        No suggestions pending.
      </p>
      {rows.length > 0 && (
        <ul className="crx-tally" data-testid="cleanup-tally">
          {rows.map((row) => (
            <li key={row.label}>
              <span className="crx-tally-n">{row.count}</span>
              <span className="crx-tally-l">{row.label}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mes-foot">
        The most recent change you applied can be undone from this page.
      </p>
    </section>
  );
}

/** One kind's queue, a card at a time. */
function ReviewQueue({ kind }: { kind: CleanupKind }) {
  const queryClient = useQueryClient();
  const queue = useQuery(cleanupQueueQuery(kind));
  const counts = useQuery(cleanupCountsQuery);
  const [cursor, setCursor] = useState(0);
  // The reviewer's wording for one card; another card, or an undo, starts over from the proposal.
  const [edit, setEdit] = useState<{ id: number; value: string } | null>(null);
  const [tally, setTally] = useState(NOTHING_YET);
  const [undo, setUndo] = useState<UndoState>({ state: "none" });
  const column = useRef<HTMLDivElement>(null);
  // Set before a request starts: render-time `isPending` lags two keys pressed in one task.
  const inFlight = useRef(false);

  const cards = queue.data;
  const card = cards?.[cursor];
  const draft =
    card === undefined
      ? ""
      : edit?.id === card.id
        ? edit.value
        : initialValue(card);

  const decide = useMutation({
    mutationFn: (args: Decision) =>
      decideCleanup(
        args.card.id,
        args.decision,
        editedValue(args.card, args.draft),
      ),
    onSuccess: (logId, args) => {
      if (logId !== null) {
        setUndo({
          state: "offer",
          logId,
          summary: appliedSummary(args.card, args.draft),
        });
      }
      const counted =
        args.decision === "rejected"
          ? "rejected"
          : editedValue(args.card, args.draft) === null
            ? "accepted"
            : "acceptedEdited";
      setTally((was) => ({ ...was, [counted]: was[counted] + 1 }));
      setCursor((at) => at + 1);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const undoLast = useMutation({
    mutationFn: undoCleanup,
    onSuccess: () => {
      setUndo({ state: "undone" });
      setTally((was) => ({ ...was, undone: was.undone + 1 }));
      setCursor(0);
      setEdit(null);
      // Back to loading: the reopened suggestion returns, so the list it replaces is never shown.
      void queryClient.resetQueries({
        queryKey: cleanupQueueQuery(kind).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: cleanupCountsQuery.queryKey,
      });
      // The Undo button is about to unmount, which would drop focus and the hotkeys with it.
      column.current?.focus();
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const busy = decide.isPending || undoLast.isPending;

  // Each is a no-op past the last card and while a request is out, so a fast key neither double-decides nor over-counts.
  const decideCard = (decision: Decision["decision"]) => {
    if (card === undefined || inFlight.current) return;
    inFlight.current = true;
    undoLast.reset();
    decide.mutate({ card, draft, decision });
  };
  const skip = () => {
    if (card === undefined || inFlight.current) return;
    setTally((was) => ({ ...was, skipped: was.skipped + 1 }));
    setCursor(cursor + 1);
  };
  const undoOffered = () => {
    if (undo.state !== "offer" || inFlight.current) return;
    inFlight.current = true;
    decide.reset();
    undoLast.mutate(undo.logId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A control keeps its own keys (Space presses a button), and a chord belongs to the browser.
    if (
      (event.target instanceof Element &&
        event.target.closest("a, button, input, select, textarea")) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    const action = reviewKeyAction(event.key);
    // A held Space would otherwise scroll the page.
    if (action === "skip") event.preventDefault();
    // A held key is one decision, not one per card it reaches.
    if (event.repeat) return;
    switch (action) {
      case "accept":
        decideCard("accepted");
        break;
      case "reject":
        decideCard("rejected");
        break;
      case "skip":
        skip();
        break;
      case null:
        break;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  };

  const failed = decide.error ?? undoLast.error ?? queue.error;
  return (
    <ReviewFrame
      kind={kind}
      counts={counts.data}
      progress={cards?.length ? { index: cursor, total: cards.length } : null}
      columnRef={column}
      onKeyDown={onKeyDown}
    >
      <UndoBar
        undo={undo}
        disabled={busy}
        busy={undoLast.isPending}
        onUndo={undoOffered}
      />
      {failed && (
        <p
          className="settings-status error"
          role="status"
          data-testid="cleanup-review-error"
        >
          {failed.message}
        </p>
      )}
      {cards === undefined ? (
        !queue.isError && (
          <Loading
            kind="section"
            testId="cleanup-review-loading"
            label="Gathering the suggestions…"
          />
        )
      ) : card ? (
        <>
          <SuggestionCardView
            card={card}
            draft={draft}
            onDraft={(value) => setEdit({ id: card.id, value })}
            onCommit={() => decideCard("accepted")}
          />
          <DecideBar
            edited={editedValue(card, draft) !== null}
            editable={isEditable(card)}
            inFlight={busy}
            onAccept={() => decideCard("accepted")}
            onReject={() => decideCard("rejected")}
            onSkip={skip}
          />
        </>
      ) : (
        <PassDone tally={tally} />
      )}
    </ReviewFrame>
  );
}

/** A slug that names no kind: the frame and a line saying so, with nothing fetched. */
function UnknownKind() {
  return (
    <ReviewFrame kind={null} counts={undefined} progress={null}>
      <p
        className="settings-status error"
        role="status"
        data-testid="cleanup-review-unknown-kind"
      >
        Unknown cleanup kind.
      </p>
    </ReviewFrame>
  );
}

/** Library cleanup: the suggestions of one kind, reviewed a card at a time. */
export function CleanupReview() {
  const { kind: slug = "" } = useParams();
  const kind = parseCleanupKind(slug);
  const { isAdmin } = useCurrentUser();
  let page = <ReviewRefusal kind={kind} />;
  if (isAdmin) {
    page =
      kind === null ? <UnknownKind /> : <ReviewQueue key={kind} kind={kind} />;
  }
  return (
    <>
      <PageTitle page="Library cleanup" />
      {page}
    </>
  );
}
