import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { type RequestListing, requestsQuery, thumbUrl } from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { BusyLabel, RowSkeletons } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider } from "../../components/Toast/Toast";
import { ago, nowSecs } from "../../format";
import { useCurrentUser } from "../../session";
import {
  canActOn,
  isCancellable,
  matchesBook,
  requestFacts,
  requestPath,
  swapFacts,
} from "../BookRequest/requestView";
import { useCancel } from "../BookRequest/useRequestActions";
import "./Requests.css";

/** One request: its book, where it stands from what was recorded, who asked and when, and Cancel for its maker or an admin. */
function RequestRow({
  listing,
  now,
}: {
  listing: RequestListing;
  now: number;
}) {
  const viewer = useCurrentUser();
  const { request, book } = listing;
  const title = useRef<HTMLAnchorElement>(null);
  const cancel = useCancel(request.id, () => title.current?.focus());
  const path = requestPath(book.uuid, request.id);
  return (
    <li
      className="rqs-row"
      data-testid="requests-row"
      data-state={request.state}
    >
      <Link to={path} className="rqs-cover" tabIndex={-1} aria-hidden="true">
        <Cover book={book} src={book.hasCover ? thumbUrl(book.uuid) : null} />
      </Link>
      <div className="rqs-book">
        <Link ref={title} to={path} className="rqs-title">
          {book.title}
        </Link>
        {book.authors.length > 0 && (
          <p className="rqs-author">{book.authors.join(", ")}</p>
        )}
      </div>
      <div className="rqs-status">
        <p className="rqs-facts">
          {requestFacts(listing, viewer.id)} · {ago(now, request.updatedAt)}
        </p>
        {swapFacts(listing).map((swap) => (
          <p key={swap.id} className="rqs-swap">
            {swap.text}
          </p>
        ))}
      </div>
      <p className="rqs-who">
        <span className="rqs-name">{listing.requesterName}</span>
        <span className="rqs-when">{ago(now, request.createdAt)}</span>
      </p>
      <div className="rqs-actions">
        {canActOn(viewer, request) && isCancellable(request) && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="requests-cancel"
            aria-label={`Cancel the request for ${book.title}`}
            aria-busy={cancel.isPending}
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            <BusyLabel
              busy={cancel.isPending}
              label="Cancel"
              busyLabel="Cancelling…"
            />
          </Button>
        )}
      </div>
    </li>
  );
}

function Empty() {
  return (
    <div className="rqs-empty" data-testid="requests-empty">
      <h2 className="rqs-empty-title">No requests yet</h2>
      <p className="rqs-empty-body">
        When anyone in the household requests a book the library lacks, from
        their wishlist or the book’s page, it shows up here.
      </p>
    </div>
  );
}

function List({ listings }: { listings: readonly RequestListing[] }) {
  const [filter, setFilter] = useState("");
  const shown = listings.filter((l) => matchesBook(l, filter));
  const now = nowSecs();
  return (
    <>
      <label className="rqs-filter">
        <input
          type="search"
          placeholder="Filter by book"
          aria-label="Filter by book"
          value={filter}
          data-testid="requests-filter"
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      {shown.length === 0 ? (
        <p className="rqs-no-match" data-testid="requests-no-match">
          No requests for a book matching “{filter.trim()}”.
        </p>
      ) : (
        <>
          <div className="rqs-cols" aria-hidden="true">
            <span>Book</span>
            <span>Where it stands</span>
            <span>Requested by</span>
          </div>
          <ul className="rqs-list">
            {shown.map((listing) => (
              <RequestRow
                key={listing.request.id}
                listing={listing}
                now={now}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** `/requests`: every reader's book requests, newest first, in every state, narrowed by the book filter. */
export function Requests() {
  const requests = useQuery(requestsQuery);
  return (
    <ToastProvider>
      <PageTitle page="Requests" />
      <div className="rqs-page" data-testid="requests-page">
        <header className="rqs-head">
          <h1 className="rqs-heading">Requests</h1>
          <p className="rqs-subline">
            Everyone’s requests, newest first. Anyone can see them; only the
            reader who asked, or an admin, can cancel one.
          </p>
        </header>
        {requests.isPending ? (
          <>
            <span className="ld-sr" role="status">
              Gathering the requests
            </span>
            <RowSkeletons count={5} avatar={false} />
          </>
        ) : requests.isError ? (
          <div className="rqs-failure">
            <p role="alert">{requests.error.message}</p>
            <Button onClick={() => requests.refetch()}>Try again</Button>
          </div>
        ) : requests.data.length === 0 ? (
          <Empty />
        ) : (
          <List listings={requests.data} />
        )}
      </div>
    </ToastProvider>
  );
}
