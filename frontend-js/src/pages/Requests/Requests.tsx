import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { type RequestListing, requestsQuery, thumbUrl } from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import {
  ChevronDownGlyph,
  ChevronRightGlyph,
} from "../../components/Glyphs/Glyphs";
import { Loading, RowSkeletons } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider } from "../../components/Toast/Toast";
import { useCurrentUser } from "../../session";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { loadRequestFolds, saveRequestFolds } from "../../viewPrefs";
import { RequestDossier } from "../BookRequest/BookRequest";
import type { DossierVariant } from "../BookRequest/RequestHistory";
import { requestPath } from "../BookRequest/requestView";
import { NotFound } from "../NotFound/NotFound";
import {
  countsLine,
  groupRequests,
  itemLine,
  type RequestGroup,
  type RequestGroupKey,
} from "./requestGroups";
import "./Requests.css";

/** One book: its cover, title and where it stands, with a dot in its group's colour. It links to the book's address, which selects it beside the list or, on a phone, opens it full screen. */
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
  const { book } = listing;
  return (
    <li>
      <Link
        to={requestPath(book.uuid)}
        onClick={onSelect}
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
  const [folds, setFolds] = useState(loadRequestFolds);
  const toggle = (key: RequestGroupKey, folded: boolean) => {
    // Storage wins for the other groups, so a second tab's folds survive this write.
    const next = { ...folds, ...loadRequestFolds(), [key]: !folded };
    setFolds(next);
    saveRequestFolds(next);
  };
  const isFolded = (key: RequestGroupKey) => folds[key] ?? key === "cancelled";
  // A selected book that moves to a folded group opens it, so its row doesn't vanish (a cancel files it under Cancelled).
  const selectedGroup = groups.find((g) =>
    g.items.some((l) => l.book.uuid === selected),
  )?.key;
  const was = useRef<{ book?: string; group?: RequestGroupKey }>({});
  useEffect(() => {
    const before = was.current;
    was.current = { book: selected, group: selectedGroup };
    const moved =
      before.book === selected &&
      before.group !== undefined &&
      before.group !== selectedGroup;
    if (!phone && moved && selectedGroup && isFolded(selectedGroup)) {
      toggle(selectedGroup, true);
    }
  });
  return groups.map((group) => {
    const folded = isFolded(group.key);
    return (
      <section
        key={group.key}
        className="rqs-group"
        aria-labelledby={`rqs-group-${group.key}`}
        data-testid={`requests-group-${group.key}`}
      >
        <h2 className="rqs-group-label">
          <button
            type="button"
            className="rqs-group-toggle"
            aria-expanded={!folded}
            aria-controls={`rqs-items-${group.key}`}
            onClick={() => toggle(group.key, folded)}
          >
            {folded ? <ChevronRightGlyph /> : <ChevronDownGlyph />}
            <span id={`rqs-group-${group.key}`}>{group.label}</span>{" "}
            <span className="rqs-group-count">{group.items.length}</span>
          </button>
        </h2>
        <ul id={`rqs-items-${group.key}`} className="rqs-items" hidden={folded}>
          {!folded &&
            group.items.map((listing) => (
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
    );
  });
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

/** The selected book's request: the one its item is filed under, or the first book's. */
function selectedListing(
  groups: readonly RequestGroup[],
  wanted: string | null,
) {
  const items = groups.flatMap((g) => g.items);
  return items.find((l) => l.book.uuid === wanted) ?? items[0];
}

/** The router state that marks `?book=` as written by the page itself, not chosen by the reader. */
const AUTO = { auto: true } as const;

const writtenByThePage = (state: unknown) =>
  typeof state === "object" && state !== null && "auto" in state;

function RequestsPage() {
  const viewer = useCurrentUser();
  const requests = useQuery(requestsQuery);
  const phone = useMediaQuery(PHONE_QUERY);
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const wanted = params.get("book");
  // Set once a reader picks a book, so its pane takes focus; a first visit leaves focus be.
  const [picked, setPicked] = useState(false);
  const listings = requests.data;
  const groups = listings ? groupRequests(listings, viewer) : [];
  const selected = listings ? selectedListing(groups, wanted) : undefined;
  const first = groups[0]?.items[0]?.book.uuid;
  // Name the first book in the address, so the pane stays on it once it is cancelled.
  useEffect(() => {
    if (!phone && wanted === null && first !== undefined) {
      setParams({ book: first }, { replace: true, state: AUTO });
    }
  }, [phone, wanted, first, setParams]);

  const dossier = (listing: RequestListing, variant: DossierVariant) => (
    <RequestDossier
      key={listing.book.uuid}
      uuid={listing.book.uuid}
      id={listing.request.id}
      variant={variant}
      focusTitle={picked}
    />
  );

  // A deep link to a book waits for the list rather than drawing the list first.
  if (phone && wanted !== null && requests.isPending) {
    return <Loading kind="page" />;
  }
  // Only a book the reader chose: the page's own first-book fallback is for the pane beside the list.
  if (
    phone &&
    selected &&
    selected.book.uuid === wanted &&
    !writtenByThePage(state)
  ) {
    return dossier(selected, "page");
  }

  return (
    <div className="rqs-page" data-testid="requests-page">
      <PageTitle page="Requests" />
      <div className="rqs-list">
        <header className="rqs-head">
          <h1 className="rqs-heading">Requests</h1>
          {groups.length > 0 && (
            <p className="rqs-subline" data-testid="requests-counts">
              {countsLine(groups)}
            </p>
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
          {dossier(selected, "pane")}
        </section>
      )}
    </div>
  );
}

/** `/requests`: every reader's book requests, one item per book grouped by where it stands, beside the selected book's request; on a phone, the list alone, or the book `?book=` names full screen. */
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
