import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type Ref, useEffect, useId, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router";
import {
  type BookUuid,
  bookRequestQuery,
  bookRequestsQuery,
  chooseRequestVersion,
  parseBookUuid,
  positiveInt,
  type BookRequest as Request,
  type RequestListing,
  type RequestVersion,
  retryBookRequest,
  thumbUrl,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider, useToast } from "../../components/Toast/Toast";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { nowSecs, recency } from "../../format";
import { useCurrentUser } from "../../session";
import { bookQuery } from "../BookDetail/queries";
import { RequestAgain, RequestHistory } from "./RequestHistory";
import {
  cameFromRequests,
  canActOn,
  isCancellable,
  isDownloading,
  isSearchStale,
  kindChip,
  kindLabel,
  offersRequestAgain,
  progressPercent,
  requestPath,
  SEARCH_STALE_AFTER_SECS,
  splitBookRequests,
  stateView,
  versionFormat,
  versionSeeders,
  versionSize,
} from "./requestView";
import { useNowPast } from "./useNowPast";
import { messageOf, useAnswer, useCancel, useSwap } from "./useRequestActions";
import "./BookRequest.css";

/** One version found: its release name over its source, format, size and seeders, a Best match badge, Details, and Choose. */
function VersionRow({
  version,
  choosing,
  locked,
  onChoose,
  rowRef,
}: {
  version: RequestVersion;
  /** This is the version being chosen. */
  choosing: boolean;
  /** Some version is being chosen, so no other can be. */
  locked: boolean;
  /** Absent when the viewer may not pick for this request. */
  onChoose: (() => void) | null;
  /** Lets the page move focus to this row. */
  rowRef?: Ref<HTMLLIElement>;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const format = versionFormat(version.format);
  const size = versionSize(version.sizeBytes);
  const meta = [
    version.indexer,
    format,
    size ?? "Size unknown",
    versionSeeders(version.seeders),
  ].filter((part) => part !== null);
  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className="rq-version"
      data-testid="request-version"
      data-best-match={version.bestMatch && !version.rejected}
      data-rejected={version.rejected}
    >
      <div className="rq-version-main">
        <div className="rq-version-text">
          <span
            className="rq-version-name"
            data-testid="request-version-name"
            title={version.title}
          >
            {version.title}
          </span>
          <span className="rq-version-meta" data-testid="request-version-meta">
            {meta.map((part, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the parts are a fixed, ordered list
              <Fragment key={index}>
                {index > 0 && <span aria-hidden="true"> · </span>}
                <span>{part}</span>
              </Fragment>
            ))}
          </span>
        </div>
        {version.rejected ? (
          <span className="rq-tried" data-testid="request-didnt-work">
            Didn’t work
          </span>
        ) : (
          version.bestMatch && (
            <span className="rq-best" data-testid="request-best-match">
              Best match
            </span>
          )
        )}
        <Button
          variant="ghost"
          size="sm"
          className="rq-details-toggle"
          data-testid="request-details-toggle"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen(!open)}
        >
          Details
        </Button>
        {onChoose && !version.rejected && (
          <Button
            variant={version.bestMatch ? "primary" : "default"}
            size="sm"
            data-testid="request-choose"
            aria-label={`Choose the ${format} version${version.indexer ? ` from ${version.indexer}` : ""}${size ? `, ${size}` : ""}`}
            aria-busy={choosing}
            disabled={locked}
            onClick={onChoose}
          >
            <BusyLabel busy={choosing} label="Choose" busyLabel="Choosing…" />
          </Button>
        )}
      </div>
      {open && (
        <dl id={detailsId} className="rq-details" data-testid="request-details">
          <div>
            <dt>Found through</dt>
            <dd>{version.indexer ?? "Not named"}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{version.title}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}

function Choices({
  request,
  canAct,
  focusFirst,
  onFocused,
}: {
  request: Request;
  canAct: boolean;
  /** Move focus to the first version, once, as the lane arrives after a swap. */
  focusFirst: boolean;
  onFocused: () => void;
}) {
  const first = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focusFirst) return;
    first.current?.focus();
    onFocused();
  }, [focusFirst, onFocused]);
  const toast = useToast();
  const answer = useAnswer(request.id);
  const choose = useMutation({
    mutationFn: (versionId: number) =>
      chooseRequestVersion(request.id, versionId),
    onSuccess: answer,
    onError: (error) =>
      toast(`Couldn’t choose that version: ${messageOf(error)}`),
  });
  return (
    <>
      {request.note && (
        <p className="rq-note" data-testid="request-note">
          {request.note}
        </p>
      )}
      <ul className="rq-versions" aria-label="Versions found">
        {request.versions.map((version, index) => (
          <VersionRow
            key={version.id}
            rowRef={index === 0 ? first : undefined}
            version={version}
            choosing={choose.isPending && choose.variables === version.id}
            locked={choose.isPending}
            onChoose={canAct ? () => choose.mutate(version.id) : null}
          />
        ))}
      </ul>
    </>
  );
}

function Chosen({ request }: { request: Request }) {
  const picked = request.versions.find((v) => v.id === request.chosenResultId);
  return (
    <p className="rq-chosen" data-testid="request-chosen">
      {picked
        ? `${versionFormat(picked.format)}${versionSize(picked.sizeBytes) ? `, ${versionSize(picked.sizeBytes)}` : ""}`
        : "Your pick"}
    </p>
  );
}

/** The one bar for a download: a native progress element, labelled, with its percent beside it. Before the client has reported, the bar has no value and no percent. Once it is complete, the wait is for the library to take it. */
function Downloading({ request }: { request: Request }) {
  if ((request.progress ?? 0) >= 1) {
    return (
      <Loading
        kind="inline"
        label="Adding it to the library…"
        testId="request-downloading"
      />
    );
  }
  const percent =
    request.progress === null ? null : progressPercent(request.progress);
  return (
    <div className="rq-progress" data-testid="request-downloading">
      <progress
        className="rq-bar"
        aria-label="Download progress"
        value={percent ?? undefined}
        max={100}
      />
      {percent !== null && (
        <span className="rq-percent" data-testid="request-percent">
          {percent}%
        </span>
      )}
    </div>
  );
}

/** Cancel while a request is still going, and Choose another while its version downloads; one at a time. */
function Actions({
  request,
  cancel,
  swap,
  cancelLabel,
}: {
  request: Request;
  cancel: ReturnType<typeof useCancel>;
  swap: ReturnType<typeof useSwap>;
  /** Names whose request it is when the viewer is an admin acting on another reader's. */
  cancelLabel: string | undefined;
}) {
  const busy = cancel.isPending || swap.isPending;
  return (
    <div className="rq-actions">
      {isDownloading(request) && (
        <Button
          variant="ghost"
          data-testid="request-pick-another"
          // aria-disabled, not disabled: a control that disables itself drops the keyboard's focus.
          aria-disabled={busy}
          aria-busy={swap.isPending}
          onClick={() => {
            if (!busy) swap.mutate();
          }}
        >
          <BusyLabel
            busy={swap.isPending}
            label="Choose another"
            busyLabel="Choosing…"
          />
        </Button>
      )}
      <Button
        variant="ghost"
        data-testid="request-cancel"
        aria-label={cancelLabel}
        aria-disabled={busy}
        aria-busy={cancel.isPending}
        onClick={() => {
          if (!busy) cancel.mutate();
        }}
      >
        <BusyLabel
          busy={cancel.isPending}
          label="Cancel"
          busyLabel="Cancelling…"
        />
      </Button>
    </div>
  );
}

/** Tries the request again: a new search, or only the add to the library after a download that could not be added. */
function TryAgain({
  request,
  onTried,
}: {
  request: Request;
  /** Runs once the new state is in, when this button is gone. */
  onTried: () => void;
}) {
  const toast = useToast();
  const answer = useAnswer(request.id);
  const retry = useMutation({
    mutationFn: () => retryBookRequest(request.id),
    onSuccess: (tried) => {
      const refreshed = answer(tried);
      onTried();
      return refreshed;
    },
    onError: (error) => toast(`Couldn’t try again: ${messageOf(error)}`),
  });
  return (
    <Button
      variant="primary"
      data-testid="request-try-again"
      disabled={retry.isPending}
      aria-busy={retry.isPending}
      onClick={() => retry.mutate()}
    >
      <BusyLabel busy={retry.isPending} label="Try again" busyLabel="Trying…" />
    </Button>
  );
}

function Stuck({
  request,
  canAct,
  onTried,
}: {
  request: Request;
  canAct: boolean;
  onTried: () => void;
}) {
  return (
    <div className="rq-stuck">
      {request.stuckDetail && (
        <p className="rq-stuck-detail" data-testid="request-stuck-detail">
          {request.stuckDetail}
        </p>
      )}
      {canAct && <TryAgain request={request} onTried={onTried} />}
    </div>
  );
}

/** Whether a search that began at `updatedAt` should have ended by now; re-checked when it would turn so. */
const useSearchStale = (updatedAt: number) =>
  isSearchStale(updatedAt, useNowPast(updatedAt + SEARCH_STALE_AFTER_SECS));

/** The wait for a search, with a way out once it has run past its timeout. */
function Looking({
  request,
  canAct,
  onTried,
}: {
  request: Request;
  canAct: boolean;
  onTried: () => void;
}) {
  const stale = useSearchStale(request.updatedAt);
  return (
    <>
      <Loading
        kind="section"
        label="Looking for versions…"
        testId="request-looking"
      />
      {stale && canAct && (
        <div className="rq-stuck">
          <p className="rq-note" data-testid="request-still-looking">
            Still looking…
          </p>
          <TryAgain request={request} onTried={onTried} />
        </div>
      )}
    </>
  );
}

/** Who made a request and how long ago: "requested by (AL) Ada Lovelace · 2h ago". */
function Requester({ request, name }: { request: Request; name: string }) {
  const viewer = useCurrentUser();
  const mine = request.userId === viewer.id;
  return (
    <p className="rq-requester" data-testid="request-requester">
      <span>· requested by</span>{" "}
      <UserAvatar
        user={{ id: request.userId, name, hasAvatar: false }}
        className="rq-avatar"
        photoClassName="rq-avatar-photo"
      />{" "}
      <span className="rq-requester-name">{mine ? "You" : name}</span>{" "}
      <span>· {recency(nowSecs(), request.createdAt)}</span>
    </p>
  );
}

/** A request's lane: its format, who asked, and what became of it in the state's own words. */
function Lane({
  request,
  context,
}: {
  request: Request;
  context: LaneContext;
}) {
  const viewer = useCurrentUser();
  const titleId = useId();
  // Held here: a cancelled request has no Cancel button left, but its Undo toast still needs this.
  const title = useRef<HTMLHeadingElement>(null);
  const focusTitle = () => title.current?.focus();
  const cancel = useCancel(request.id, focusTitle);
  const [focusVersions, setFocusVersions] = useState(false);
  const swap = useSwap(request.id, () => setFocusVersions(true));
  const now = useNowPast(request.cancelAt);
  // Anyone may read a request; only its maker, or an admin, may act on it.
  const canAct = canActOn(viewer, request);
  const name = context.listings.find(
    (l) => l.request.id === request.id,
  )?.requesterName;
  const cancelLabel =
    request.userId === viewer.id
      ? undefined
      : `Cancel ${name ?? "another reader"}’s request for ${context.title}`;
  const actions = canAct && isCancellable(request) && (
    <Actions
      request={request}
      cancel={cancel}
      swap={swap}
      cancelLabel={cancelLabel}
    />
  );
  const { heading, note } = stateView(request.state, request.stuckReason);
  return (
    <section
      className="rq-panel rq-lane"
      aria-labelledby={titleId}
      data-testid={`request-lane-${request.kind}`}
    >
      <div className="rq-lane-head">
        <span className="rq-chip">{kindChip(request.kind)}</span>
        <h2 ref={title} tabIndex={-1} id={titleId} className="rq-lane-title">
          {kindLabel(request.kind)}
        </h2>
        {name !== undefined && <Requester request={request} name={name} />}
      </div>
      <p
        className="rq-state"
        role="status"
        data-testid="request-state"
        data-state={request.state}
      >
        {heading}
      </p>
      <p className="rq-note">{note}</p>
      {request.state === "looking" && (
        <Looking request={request} canAct={canAct} onTried={focusTitle} />
      )}
      {request.state === "choose" && (
        <Choices
          request={request}
          canAct={canAct}
          focusFirst={focusVersions}
          onFocused={() => setFocusVersions(false)}
        />
      )}
      {request.state === "chosen" && <Chosen request={request} />}
      {request.state === "on_its_way" ? (
        <div className="rq-download">
          <div className="rq-download-main">
            <Chosen request={request} />
            <Downloading request={request} />
          </div>
          {actions}
        </div>
      ) : (
        actions
      )}
      {request.state === "stuck" && (
        <Stuck request={request} canAct={canAct} onTried={focusTitle} />
      )}
      {offersRequestAgain(request, viewer, context.requests, now) && (
        <div className="rq-actions">
          <RequestAgain uuid={request.bookUuid} stay={context.stay} />
        </div>
      )}
    </section>
  );
}

/** What a lane needs to know about the rest of the book's requests. */
type LaneContext = {
  /** The book's title, for an admin's Cancel label. */
  title: string;
  /** The book's requests as listed, for who made each; empty until read. */
  listings: readonly RequestListing[];
  /** The same requests, for whether Request again would only return one already going. */
  requests: readonly Request[];
  /** Request again stays on the page rather than opening the new request. */
  stay: boolean;
};

/** Another reader's request still going for the book, in a lane of its own. */
function OtherLane({ id, context }: { id: number; context: LaneContext }) {
  const request = useQuery(bookRequestQuery(id));
  if (request.data === undefined) {
    return request.isPending ? (
      <Loading kind="section" label="Reading this request…" />
    ) : null;
  }
  return <Lane request={request.data} context={context} />;
}

/** Where a book's requests are shown: on its own page, or in the Requests list's pane. */
export type DossierVariant = "page" | "pane";

/** A book's requests: the book above, a lane for the request asked for and each other one still going, and the book's history below. Shared by the book's request page and the Requests list's detail pane. */
export function RequestDossier({
  uuid,
  id,
  variant,
}: {
  uuid: BookUuid;
  id: number;
  variant: DossierVariant;
}) {
  const book = useQuery(bookQuery(uuid));
  const request = useQuery(bookRequestQuery(id));
  const listed = useQuery(bookRequestsQuery(uuid));
  const { state } = useLocation();
  const back = `/books/${uuid}`;
  // A failed background poll keeps showing what was last read.
  if (book.data === undefined || request.data === undefined) {
    if (book.isPending || request.isPending) {
      return <Loading kind={variant === "page" ? "page" : "section"} />;
    }
    return (
      <PageError
        message={messageOf(book.error ?? request.error)}
        backTo={back}
        backLabel="Back to book"
      />
    );
  }
  if (book.data === null) return <PageNotFound subject="Book" />;
  // The address named the book by an old uuid; the request knows the current one.
  if (request.data.bookUuid !== uuid) {
    return <Navigate replace to={requestPath(request.data.bookUuid, id)} />;
  }
  const { title, authors } = book.data;
  const listings = listed.data ?? [];
  const context: LaneContext = {
    title,
    listings,
    requests: listings.map((l) => l.request),
    stay: variant === "pane",
  };
  const Title = variant === "page" ? "h1" : "h2";
  return (
    <div
      className="rq-page"
      data-variant={variant}
      data-testid={variant === "page" ? "request-page" : "requests-pane"}
    >
      {variant === "page" && <PageTitle page={`Request ${title}`} />}
      {variant === "page" && cameFromRequests(state) && (
        <Link className="rq-back" to="/requests">
          ‹ Requests
        </Link>
      )}
      <header className="rq-head">
        <div className="rq-cover">
          <Cover
            book={book.data}
            src={book.data.hasCover ? thumbUrl(uuid) : null}
          />
        </div>
        <div className="rq-head-text">
          <Title className="rq-title" data-testid="request-title">
            {title}
          </Title>
          {authors.length > 0 && (
            <p className="rq-author">{authors.join(", ")}</p>
          )}
        </div>
        <Link className="rq-open" to={back}>
          Open book page
        </Link>
      </header>
      <Lane key={request.data.id} request={request.data} context={context} />
      {splitBookRequests(listings, id).lanes.map((other) => (
        <OtherLane
          key={other.request.id}
          id={other.request.id}
          context={context}
        />
      ))}
      <RequestHistory uuid={uuid} shown={id} stay={context.stay} />
    </div>
  );
}

/** A book's request page: the request named by `?id=`, with the book's other requests. */
export function BookRequest() {
  const { uuid: rawUuid } = useParams();
  const [params] = useSearchParams();
  const uuid = parseBookUuid(rawUuid);
  const id = positiveInt(params.get("id"));
  if (!uuid || id === null) {
    return <PageNotFound subject="Request" />;
  }
  return (
    <ToastProvider>
      <RequestDossier uuid={uuid} id={id} variant="page" />
    </ToastProvider>
  );
}
