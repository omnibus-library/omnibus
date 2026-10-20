import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import {
  type CleanupKind,
  cleanupCountsQuery,
  cleanupQueueQuery,
  decideCleanup,
  parseCleanupKind,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { useCurrentUser } from "../../session";
import { ReviewFrame, ReviewRefusal } from "./ReviewFrame";
import { isEditable } from "./review";
import { DecideBar, SuggestionCardView } from "./SuggestionCard";

/** The end of a pass: nothing left to decide. */
function PassDone() {
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
      <p className="mes-foot">
        The most recent change you applied can be undone from this page.
      </p>
    </section>
  );
}

/** One kind's queue, a card at a time. */
function ReviewQueue({ kind }: { kind: CleanupKind }) {
  const queue = useQuery(cleanupQueueQuery(kind));
  const counts = useQuery(cleanupCountsQuery);
  const [cursor, setCursor] = useState(0);
  const decide = useMutation({
    mutationFn: (args: { id: number; decision: "accepted" | "rejected" }) =>
      decideCleanup(args.id, args.decision),
    onSuccess: () => setCursor((at) => at + 1),
  });
  const cards = queue.data;
  const card = cards?.[cursor];
  const failed = decide.error ?? queue.error;

  return (
    <ReviewFrame
      kind={kind}
      counts={counts.data}
      progress={cards?.length ? { index: cursor, total: cards.length } : null}
    >
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
          <SuggestionCardView key={card.id} card={card} />
          <DecideBar
            editable={isEditable(card)}
            inFlight={decide.isPending}
            onAccept={() =>
              decide.mutate({ id: card.id, decision: "accepted" })
            }
            onReject={() =>
              decide.mutate({ id: card.id, decision: "rejected" })
            }
            onSkip={() => setCursor(cursor + 1)}
          />
        </>
      ) : (
        <PassDone />
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
