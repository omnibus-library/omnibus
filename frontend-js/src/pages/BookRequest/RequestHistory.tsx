import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  type BookUuid,
  bookRequestsQuery,
  type RequestListing,
  type User,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { ago, nowSecs } from "../../format";
import { useCurrentUser } from "../../session";
import { requestFacts, requestPath, swapFacts } from "./requestView";
import { useStartRequest } from "./useStartRequest";

/** Starts a new request for the book, for the viewer, and opens it in Looking. */
export function RequestAgain({ uuid }: { uuid: BookUuid }) {
  const start = useStartRequest(uuid);
  return (
    <Button
      size="sm"
      data-testid="request-again"
      disabled={start.isPending}
      aria-busy={start.isPending}
      onClick={() => start.mutate()}
    >
      <BusyLabel
        busy={start.isPending}
        label="Request again"
        busyLabel="Requesting…"
      />
    </Button>
  );
}

function HistoryRow({
  listing,
  viewer,
  now,
}: {
  listing: RequestListing;
  viewer: User;
  now: number;
}) {
  const { request } = listing;
  const who = request.userId === viewer.id ? "you" : listing.requesterName;
  return (
    <li
      className="rq-history-row"
      data-testid="request-history-row"
      data-state={request.state}
    >
      <div className="rq-history-text">
        <Link
          className="rq-history-facts"
          to={requestPath(request.bookUuid, request.id)}
        >
          {requestFacts(listing, viewer.id)} · {ago(now, request.updatedAt)}
        </Link>
        {swapFacts(listing).map((swap) => (
          <p key={swap.id} className="rq-history-swap">
            {swap.text}
          </p>
        ))}
        <p className="rq-history-meta">
          Requested by {who} · {ago(now, request.createdAt)}
        </p>
      </div>
      {request.state === "cancelled" && viewer.canRequest && (
        <RequestAgain uuid={request.bookUuid} />
      )}
    </li>
  );
}

/** The book's other requests, newest first, each saying only what was recorded; nothing when it has none. */
export function RequestHistory({
  uuid,
  shown,
}: {
  uuid: BookUuid;
  /** The request on screen, which is not its own history. */
  shown: number;
}) {
  const viewer = useCurrentUser();
  const history = useQuery(bookRequestsQuery(uuid));
  if (history.isPending) {
    return <Loading kind="section" label="Reading this book’s history…" />;
  }
  if (history.isError) {
    return (
      <p role="alert" className="rq-note">
        Couldn’t read this book’s request history.
      </p>
    );
  }
  const past = history.data.filter((l) => l.request.id !== shown);
  if (past.length === 0) return null;
  const now = nowSecs();
  return (
    <section
      className="rq-panel"
      aria-labelledby="rq-history-title"
      data-testid="request-history"
    >
      <h2 id="rq-history-title" className="rq-lane-title">
        History
      </h2>
      <ul className="rq-history">
        {past.map((listing) => (
          <HistoryRow
            key={listing.request.id}
            listing={listing}
            viewer={viewer}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
}
