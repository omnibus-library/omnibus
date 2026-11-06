import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  type BookUuid,
  bookRequestsQuery,
  type BookRequest as Request,
  type RequestListing,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { useCurrentUser } from "../../session";
import {
  historyDay,
  kindChip,
  offersRequestAgain,
  requestFacts,
  requestPath,
  splitBookRequests,
  swapFacts,
} from "./requestView";
import { useNowPast } from "./useNowPast";
import { useStartRequest } from "./useStartRequest";

/** Starts a new request for the book, for the viewer, and opens it in Looking; with `stay`, the page stays put. */
export function RequestAgain({
  uuid,
  stay,
}: {
  uuid: BookUuid;
  stay: boolean;
}) {
  const start = useStartRequest(uuid, stay);
  return (
    <Button
      size="sm"
      data-testid="request-again"
      // aria-disabled, not disabled: a control that disables itself drops the keyboard's focus.
      aria-disabled={start.isPending}
      aria-busy={start.isPending}
      onClick={() => {
        if (!start.isPending) start.mutate();
      }}
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
  requests,
  stay,
}: {
  listing: RequestListing;
  /** Every request for the book, for whether Request again would only return one going. */
  requests: readonly Request[];
  stay: boolean;
}) {
  const viewer = useCurrentUser();
  const { request } = listing;
  const now = useNowPast(request.cancelAt);
  return (
    <li
      className="rq-history-row"
      data-testid="request-history-row"
      data-state={request.state}
    >
      <span className="rq-history-day" data-testid="request-history-day">
        {historyDay(request.updatedAt)}
      </span>
      <span className="rq-chip">{kindChip(request.kind)}</span>
      <div className="rq-history-text">
        <Link
          className="rq-history-facts"
          to={requestPath(request.bookUuid, request.id)}
        >
          {requestFacts(listing, viewer.id)}
        </Link>
        {swapFacts(listing).map((swap) => (
          <p key={swap.id} className="rq-history-swap">
            {swap.text}
          </p>
        ))}
      </div>
      {offersRequestAgain(request, viewer, requests, now) && (
        <RequestAgain uuid={request.bookUuid} stay={stay} />
      )}
    </li>
  );
}

/** The book's past requests, newest first, each saying only what was recorded; nothing when it has none. */
export function RequestHistory({
  uuid,
  shown,
  stay,
}: {
  uuid: BookUuid;
  /** The request on screen, which is not its own history. */
  shown: number;
  /** Request again stays on the page rather than opening the new request. */
  stay: boolean;
}) {
  const history = useQuery(bookRequestsQuery(uuid));
  // A failed background read keeps showing what was last read.
  if (history.data === undefined) {
    if (history.isPending) {
      return <Loading kind="section" label="Reading this book’s history…" />;
    }
    return (
      <div className="rq-history-failed">
        <p role="alert" className="rq-note">
          Couldn’t read this book’s request history.
        </p>
        <Button size="sm" onClick={() => history.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const past = splitBookRequests(history.data, shown).history;
  if (past.length === 0) return null;
  const requests = history.data.map((l) => l.request);
  return (
    <section
      className="rq-history-block"
      aria-labelledby="rq-history-title"
      data-testid="request-history"
    >
      <h2 id="rq-history-title" className="rq-label">
        History
      </h2>
      <ul className="rq-history">
        {past.map((listing) => (
          <HistoryRow
            key={listing.request.id}
            listing={listing}
            requests={requests}
            stay={stay}
          />
        ))}
      </ul>
    </section>
  );
}
