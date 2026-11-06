import type { UseQueryResult } from "@tanstack/react-query";
import type { BookUuid, RequestListing } from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { useCurrentUser } from "../../session";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import {
  factParts,
  historyDay,
  kindChip,
  kindLabel,
  offersRequestAgain,
  SEP,
  swapFacts,
} from "./requestView";
import { useNowPast } from "./useNowPast";
import { useStartRequest } from "./useStartRequest";

/** Where a book's requests are shown: full screen on a phone, or in the Requests list's pane. */
export type DossierVariant = "page" | "pane";

/** Starts a new request for the book, for the viewer; the page stays put while its lists are read again. */
export function RequestAgain({ uuid }: { uuid: BookUuid }) {
  const start = useStartRequest(uuid, { stay: true });
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
  listings,
}: {
  listing: RequestListing;
  /** Every request for the book, for whether Request again would only return one going. */
  listings: readonly RequestListing[];
}) {
  const viewer = useCurrentUser();
  const phone = useMediaQuery(PHONE_QUERY);
  const { request } = listing;
  const now = useNowPast(request.cancelAt);
  const { head, details } = factParts(listing, viewer.id);
  const day = historyDay(request.updatedAt);
  return (
    <li
      className="rq-history-row"
      data-testid="request-history-row"
      data-state={request.state}
    >
      {phone ? (
        <div className="rq-history-text">
          <p className="rq-history-facts">
            {`${kindLabel(request.kind)} ${head.charAt(0).toLowerCase()}${head.slice(1)}${SEP}${day}`}
          </p>
          {details.length > 0 && (
            <p className="rq-history-swap">{details.join(SEP)}</p>
          )}
          {swapFacts(listing).map((swap) => (
            <p key={swap.id} className="rq-history-swap">
              {swap.text}
            </p>
          ))}
        </div>
      ) : (
        <>
          <span className="rq-history-day" data-testid="request-history-day">
            {day}
          </span>
          <span className="rq-chip">{kindChip(request.kind)}</span>
          <div className="rq-history-text">
            <p className="rq-history-facts">{[head, ...details].join(" · ")}</p>
            {swapFacts(listing).map((swap) => (
              <p key={swap.id} className="rq-history-swap">
                {swap.text}
              </p>
            ))}
          </div>
        </>
      )}
      {offersRequestAgain(
        request,
        viewer,
        listings.map((l) => l.request),
        now,
      ) && <RequestAgain uuid={request.bookUuid} />}
    </li>
  );
}

/** The book's past requests, newest first, each saying only what was recorded; nothing when it has none. */
export function RequestHistory({
  listed,
  history,
  variant,
}: {
  /** The read of the book's requests that `history` came from. */
  listed: UseQueryResult<RequestListing[]>;
  /** The book's past requests; `undefined` until `listed` has answered. */
  history: readonly RequestListing[] | undefined;
  variant: DossierVariant;
}) {
  // A failed background read keeps showing what was last read.
  if (history === undefined || listed.data === undefined) {
    if (listed.isPending) {
      return <Loading kind="section" label="Reading this book’s history…" />;
    }
    return (
      <div className="rq-history-failed">
        <p role="alert" className="rq-note">
          Couldn’t read this book’s request history.
        </p>
        <Button size="sm" onClick={() => listed.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (history.length === 0) return null;
  const Heading = variant === "pane" ? "h3" : "h2";
  return (
    <section
      className="rq-history-block"
      aria-labelledby="rq-history-title"
      data-testid="request-history"
    >
      <Heading id="rq-history-title" className="rq-label">
        History
      </Heading>
      <ul className="rq-history">
        {history.map((listing) => (
          <HistoryRow
            key={listing.request.id}
            listing={listing}
            listings={listed.data}
          />
        ))}
      </ul>
    </section>
  );
}
