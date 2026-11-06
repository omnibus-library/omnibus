import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type RequestListing, requestsQuery, thumbUrl } from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { RowSkeletons } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider } from "../../components/Toast/Toast";
import { useCurrentUser } from "../../session";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { RequestDossier } from "../BookRequest/BookRequest";
import { FROM_REQUESTS, requestPath } from "../BookRequest/requestView";
import { NotFound } from "../NotFound/NotFound";
import { AddRequest } from "./AddRequest";
import {
  countsLine,
  groupRequests,
  itemLine,
  type RequestGroup,
  type RequestGroupKey,
} from "./requestGroups";
import "./Requests.css";

/** The address that selects `uuid`'s book in the list. */
const selectPath = (uuid: string) =>
  `/requests?book=${encodeURIComponent(uuid)}`;

/** One book: its cover, title and where it stands, with a dot in its group's colour. On a phone it opens the book's request page; otherwise it selects the book. */
function Item({
  listing,
  group,
  selected,
  phone,
  onSelect,
}: {
  listing: RequestListing;
  group: RequestGroupKey;
  selected: boolean;
  phone: boolean;
  onSelect: () => void;
}) {
  const { book, request } = listing;
  return (
    <li>
      <Link
        to={phone ? requestPath(book.uuid, request.id) : selectPath(book.uuid)}
        state={phone ? FROM_REQUESTS : undefined}
        onClick={phone ? undefined : onSelect}
        className="rqs-item"
        aria-current={selected ? "true" : undefined}
        data-testid="requests-item"
        data-group={group}
      >
        <span className="rqs-cover" aria-hidden="true">
          <Cover book={book} src={book.hasCover ? thumbUrl(book.uuid) : null} />
        </span>
        <span className="rqs-item-text">
          <span className="rqs-item-title">{book.title}</span>
          <span className="rqs-item-line" data-testid="requests-item-line">
            {itemLine(listing, group, phone)}
          </span>
        </span>
        <span className="rqs-dot" data-group={group} aria-hidden="true" />
        {phone && (
          <span className="rqs-chevron" aria-hidden="true">
            ›
          </span>
        )}
      </Link>
    </li>
  );
}

function Groups({
  groups,
  selected,
  phone,
  onSelect,
}: {
  groups: readonly RequestGroup[];
  selected: string | undefined;
  phone: boolean;
  onSelect: () => void;
}) {
  return groups.map((group) => (
    <section
      key={group.key}
      className="rqs-group"
      aria-labelledby={`rqs-group-${group.key}`}
      data-testid={`requests-group-${group.key}`}
    >
      <h2 id={`rqs-group-${group.key}`} className="rqs-group-label">
        {group.label}
      </h2>
      <ul className="rqs-items">
        {group.items.map((listing) => (
          <Item
            key={listing.book.uuid}
            listing={listing}
            group={group.key}
            selected={!phone && listing.book.uuid === selected}
            phone={phone}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  ));
}

function Empty() {
  return (
    <div className="rqs-empty" data-testid="requests-empty">
      <h2 className="rqs-empty-title">No requests yet</h2>
      <p className="rqs-empty-body">
        A book anyone in the household asks for shows up here.
      </p>
    </div>
  );
}

/** The selected book's request: the one its item is filed under, or, for a book whose requests were all cancelled while it was selected, the one that changed last. */
function selectedListing(
  groups: readonly RequestGroup[],
  listings: readonly RequestListing[],
  wanted: string | null,
) {
  const items = groups.flatMap((g) => g.items);
  const lastChanged = listings
    .filter((l) => l.book.uuid === wanted)
    .reduce<RequestListing | undefined>(
      (last, l) =>
        last === undefined || l.request.updatedAt > last.request.updatedAt
          ? l
          : last,
      undefined,
    );
  return items.find((l) => l.book.uuid === wanted) ?? lastChanged ?? items[0];
}

function RequestsPage() {
  const viewer = useCurrentUser();
  const requests = useQuery(requestsQuery);
  const phone = useMediaQuery(PHONE_QUERY);
  const [params, setParams] = useSearchParams();
  const wanted = params.get("book");
  // Set once a reader picks a book, so its pane takes focus; a first visit leaves focus be.
  const [picked, setPicked] = useState(false);
  const listings = requests.data;
  const groups = listings ? groupRequests(listings, viewer) : [];
  const selected = listings
    ? selectedListing(groups, listings, wanted)
    : undefined;
  const first = groups[0]?.items[0]?.book.uuid;
  const select = (uuid: string) => {
    setParams({ book: uuid });
    setPicked(true);
  };
  // Name the first book in the address, so the pane stays on it once it is cancelled.
  useEffect(() => {
    if (!phone && wanted === null && first !== undefined) {
      setParams({ book: first }, { replace: true });
    }
  }, [phone, wanted, first, setParams]);

  return (
    <div className="rqs-page" data-testid="requests-page">
      <PageTitle page="Requests" />
      <div className="rqs-list">
        <header className="rqs-head">
          <div className="rqs-head-text">
            <h1 className="rqs-heading">Requests</h1>
            {groups.length > 0 && (
              <p className="rqs-subline" data-testid="requests-counts">
                {countsLine(groups)}
              </p>
            )}
          </div>
          {/* Only a failed first read hides it: a failed refresh keeps the lists, and a start in flight. */}
          {(!requests.isError || listings !== undefined) && (
            <AddRequest listings={listings} onSelect={select} />
          )}
        </header>
        {listings === undefined ? (
          requests.isPending ? (
            <>
              <span className="ld-sr" role="status">
                Gathering the requests
              </span>
              <RowSkeletons count={6} avatar={false} />
            </>
          ) : (
            <div className="rqs-failure">
              <p role="alert">Couldn’t read the requests.</p>
              <Button size="sm" onClick={() => requests.refetch()}>
                Try again
              </Button>
            </div>
          )
        ) : groups.length === 0 ? (
          <Empty />
        ) : (
          <Groups
            groups={groups}
            selected={selected?.book.uuid}
            phone={phone}
            onSelect={() => setPicked(true)}
          />
        )}
      </div>
      {!phone && selected && (
        <section className="rqs-pane" aria-label="Selected request">
          <RequestDossier
            key={selected.book.uuid}
            uuid={selected.book.uuid}
            id={selected.request.id}
            variant="pane"
            focusTitle={picked}
          />
        </section>
      )}
    </div>
  );
}

/** `/requests`: every reader's book requests, one item per book grouped by where it stands, beside the selected book's request; a phone gets the list alone. */
export function Requests() {
  const { requestsOn } = useCurrentUser();
  // Off on this server: the route answers as if it were not there, and nothing is asked of it.
  if (!requestsOn) return <NotFound />;
  return (
    <ToastProvider>
      <RequestsPage />
    </ToastProvider>
  );
}
