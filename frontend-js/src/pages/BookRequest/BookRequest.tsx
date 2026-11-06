import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router";
import {
  type Book,
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
  wishlistBooksQuery,
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
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { bookQuery } from "../BookDetail/queries";
import { Ready } from "./Ready";
import {
  type DossierVariant,
  RequestAgain,
  RequestHistory,
} from "./RequestHistory";
import {
  cameFrom,
  canActOn,
  downloadPercent,
  firstShown,
  isCancellable,
  isDownloading,
  isSearchStale,
  kindChip,
  kindLabel,
  offersRequestAgain,
  pickedMeta,
  pickedVersion,
  progressPercent,
  type RequestStep,
  requestPath,
  SEARCH_STALE_AFTER_SECS,
  SEP,
  splitBookRequests,
  stateView,
  stepsFor,
  versionSize,
  versionSource,
  versionsFound,
  wishersLine,
} from "./requestView";
import { useNowPast } from "./useNowPast";
import { messageOf, useAnswer, useCancel, useSwap } from "./useRequestActions";
import { useTimeLeft } from "./useTimeLeft";
import "./BookRequest.css";

/** One version found: its release name, its source line, a Best match or Didn’t work tag, Choose, and the long form when Details is open. */
function VersionRow({
  version,
  choosing,
  locked,
  details,
  onChoose,
  rowRef,
}: {
  version: RequestVersion;
  /** This is the version being chosen. */
  choosing: boolean;
  /** Some version is being chosen, so no other can be. */
  locked: boolean;
  /** Details is open for the lane. */
  details: boolean;
  /** Absent when the viewer may not pick for this request. */
  onChoose: (() => void) | null;
  /** Lets the page move focus to this row. */
  rowRef?: Ref<HTMLLIElement>;
}) {
  const textId = useId();
  const best = version.bestMatch && !version.rejected;
  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className="rq-version"
      data-testid="request-version"
      data-best-match={best}
      data-rejected={version.rejected}
    >
      <div id={textId} className="rq-version-text">
        <p className="rq-version-name" data-testid="request-version-name">
          {version.title}
        </p>
        <p className="rq-version-meta" data-testid="request-version-meta">
          {versionSource(version)}
        </p>
        {version.rejected ? (
          <p className="rq-tag" data-testid="request-didnt-work">
            Didn’t work
          </p>
        ) : (
          best && (
            <p className="rq-tag" data-testid="request-best-match">
              Best match
            </p>
          )
        )}
      </div>
      {onChoose && !version.rejected && (
        <Button
          variant={best ? "primary" : "default"}
          size="sm"
          data-testid="request-choose"
          aria-describedby={textId}
          aria-busy={choosing}
          // aria-disabled, not disabled: a control that disables itself drops the keyboard's focus.
          aria-disabled={locked}
          onClick={() => {
            if (!locked) onChoose();
          }}
        >
          <BusyLabel busy={choosing} label="Choose" busyLabel="Choosing…" />
        </Button>
      )}
      {details && (
        <dl className="rq-details" data-testid="request-details">
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
  const listId = useId();
  const [all, setAll] = useState(false);
  const [details, setDetails] = useState(false);
  const toast = useToast();
  const answer = useAnswer(request.id);
  const choose = useMutation({
    mutationFn: (versionId: number) =>
      chooseRequestVersion(request.id, versionId),
    onSuccess: answer,
    onError: (error) =>
      toast(`Couldn’t choose that version: ${messageOf(error)}`),
  });
  const collapsed = firstShown(request.versions);
  const shown = all ? request.versions : collapsed;
  const hidden = request.versions.length - collapsed.length;
  return (
    <>
      {request.note && (
        <p className="rq-note" data-testid="request-note">
          {request.note}
        </p>
      )}
      <p className="rq-found" data-testid="request-versions-found">
        {versionsFound(request.versions)}
      </p>
      <ul id={listId} className="rq-versions" aria-label="Versions found">
        {shown.map((version, index) => (
          <VersionRow
            key={version.id}
            rowRef={index === 0 ? first : undefined}
            version={version}
            choosing={choose.isPending && choose.variables === version.id}
            locked={choose.isPending}
            details={details}
            onChoose={canAct ? () => choose.mutate(version.id) : null}
          />
        ))}
      </ul>
      <div className="rq-version-links">
        {hidden > 0 && (
          <button
            type="button"
            className="rq-link"
            data-testid="request-show-more"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `Show ${hidden} more`}
          </button>
        )}
        <button
          type="button"
          className="rq-link quiet"
          data-testid="request-details-toggle"
          aria-expanded={details}
          aria-controls={listId}
          onClick={() => setDetails(!details)}
        >
          Details
        </button>
      </div>
    </>
  );
}

/** The version picked, named as its row named it: the release name over its size and source, with `children` (a download's bar) between, and `extra` (its time left) after the source. */
function Picked({
  request,
  children,
  extra,
}: {
  request: Request;
  children?: ReactNode;
  extra?: string | null;
}) {
  const picked = pickedVersion(request);
  const meta = [picked ? pickedMeta(picked) : "", extra ?? ""]
    .filter((part) => part)
    .join(SEP);
  return (
    <div className="rq-picked" data-testid="request-chosen">
      <p className="rq-version-name" title={picked?.title}>
        {picked ? picked.title : "Your pick"}
      </p>
      {children}
      {meta && <p className="rq-version-meta">{meta}</p>}
    </div>
  );
}

/** The one bar for a download: a native progress element, labelled; its percent is on the lane's stepper. Before the client has reported, the bar has no value. Once it is complete, the wait is for the library to take it. */
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
    </div>
  );
}

/** A download in its own card: the pick, its bar and its time left, with Choose another and Cancel beside. A phone heads the card with the format and size, dims the release name, ends on the percent and time left, and sets the buttons below. */
function Download({
  request,
  actions,
}: {
  request: Request;
  actions: ReactNode;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const left = useTimeLeft(request);
  if (!phone) {
    return (
      <div className="rq-download">
        <Picked request={request} extra={left}>
          <Downloading request={request} />
        </Picked>
        {actions}
      </div>
    );
  }
  const picked = pickedVersion(request);
  const percent = downloadPercent(request);
  const heading = picked
    ? [picked.format, versionSize(picked.sizeBytes)]
        .filter((part) => part !== null)
        .join(SEP)
    : "Your pick";
  return (
    <>
      <div className="rq-download" data-testid="request-chosen">
        <div className="rq-picked">
          <p className="rq-download-heading">{heading}</p>
          {picked && <p className="rq-version-meta">{picked.title}</p>}
          <Downloading request={request} />
          {(percent !== null || left) && (
            <p className="rq-version-meta">
              {percent !== null && (
                <span data-testid="request-percent">{percent}%</span>
              )}
              {percent !== null && left && SEP}
              {left}
            </p>
          )}
        </div>
      </div>
      {actions}
    </>
  );
}

/** Where a request stands as steps: Looking, Choose a version, On its way, Ready. */
function Steps({ steps }: { steps: readonly RequestStep[] }) {
  // A phone shows the download's percent in its card instead.
  const phone = useMediaQuery(PHONE_QUERY);
  return (
    <ol className="rq-steps" aria-label="Progress of this request">
      {steps.map((step) => (
        <li
          key={step.label}
          className="rq-step"
          data-status={step.status}
          aria-current={step.status === "current" ? "step" : undefined}
        >
          <span className="rq-step-dot" aria-hidden="true" />
          <span>
            {step.label}
            {step.percent !== null && !phone && (
              <>
                {" · "}
                <span data-testid="request-percent">{step.percent}%</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
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
  // Under the versions, Cancel sits with the text links as the comp's smaller "Cancel request".
  const choosing = request.state === "choose";
  return (
    <div className="rq-actions">
      {isDownloading(request) && (
        <Button
          variant="ghost"
          size="sm"
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
        size="sm"
        className={choosing ? "rq-flush" : undefined}
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
          label={choosing ? "Cancel request" : "Cancel"}
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

/** Who made a request and how long ago: "requested by (AL) Ada Lovelace · 2h ago"; a phone drops "requested by". */
function Requester({
  request,
  listing,
}: {
  request: Request;
  listing: RequestListing;
}) {
  const viewer = useCurrentUser();
  const phone = useMediaQuery(PHONE_QUERY);
  const mine = request.userId === viewer.id;
  const user = {
    id: request.userId,
    name: listing.requesterName,
    hasAvatar: listing.requesterHasAvatar,
  };
  return (
    <p className="rq-requester" data-testid="request-requester">
      {!phone && <span>· requested by</span>}{" "}
      <UserAvatar
        user={user}
        className="rq-avatar"
        photoClassName="rq-avatar-photo"
      />{" "}
      <span className="rq-requester-name">
        {mine ? "You" : listing.requesterName}
      </span>{" "}
      <span>· {recency(nowSecs(), request.createdAt)}</span>
    </p>
  );
}

/** A request's lane: its format, who asked, and what became of it in the state's own words. */
function Lane({
  request,
  context,
  main,
}: {
  request: Request;
  context: LaneContext;
  /** The request the page or pane is for, rather than another one still going for the book. */
  main: boolean;
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
  const listing = context.listings?.find((l) => l.request.id === request.id);
  const mine = request.userId === viewer.id;
  // Another reader's Cancel names whose request it is, so it waits for the list that says.
  const cancelLabel = mine
    ? undefined
    : listing &&
      `Cancel ${listing.requesterName}’s request for ${context.book.title}`;
  const actions = canAct && isCancellable(request) && (mine || cancelLabel) && (
    <Actions
      request={request}
      cancel={cancel}
      swap={swap}
      cancelLabel={cancelLabel}
    />
  );
  const Heading = context.variant === "pane" ? "h3" : "h2";
  const { heading, note } = stateView(request.state, request.stuckReason);
  const steps = stepsFor(request);
  return (
    <section
      className="rq-panel rq-lane"
      aria-labelledby={titleId}
      data-needs-you={request.state === "choose" && canAct}
      data-testid={`${main ? "request-lane" : "request-other-lane"}-${request.kind}`}
    >
      <div className="rq-lane-head">
        <span className="rq-chip">{kindChip(request.kind)}</span>
        <Heading
          ref={title}
          tabIndex={-1}
          id={titleId}
          className="rq-lane-title"
        >
          {kindLabel(request.kind)}
        </Heading>
        {listing && <Requester request={request} listing={listing} />}
      </div>
      {/* The stepper shows where it stands; the words stay for a screen reader to announce. */}
      <p
        className={steps ? "rq-state ld-sr" : "rq-state"}
        role="status"
        data-testid="request-state"
        data-state={request.state}
      >
        {heading}
      </p>
      {steps ? (
        <Steps steps={steps} />
      ) : (
        note && <p className="rq-note">{note}</p>
      )}
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
      {request.state === "chosen" && <Picked request={request} />}
      {request.state === "ready" && (
        <Ready
          request={request}
          canAct={canAct}
          book={context.book}
          onSettled={focusTitle}
        />
      )}
      {request.state === "on_its_way" ? (
        <Download request={request} actions={actions} />
      ) : (
        actions
      )}
      {request.state === "stuck" && (
        <Stuck request={request} canAct={canAct} onTried={focusTitle} />
      )}
      {context.listings &&
        offersRequestAgain(
          request,
          viewer,
          context.listings.map((l) => l.request),
          now,
        ) && (
          <div className="rq-actions">
            <RequestAgain
              uuid={request.bookUuid}
              stay={context.variant === "pane"}
            />
          </div>
        )}
    </section>
  );
}

/** What a lane needs to know about the rest of the book's requests. */
type LaneContext = {
  /** The book: its title names an admin's Cancel, and its look stands in for its covers. */
  book: Book;
  /** The book's requests as listed, for who made each and whether Request again would only return one going; `undefined` until read. */
  listings: readonly RequestListing[] | undefined;
  variant: DossierVariant;
};

/** Another reader's request still going for the book, in a lane of its own. */
function OtherLane({ id, context }: { id: number; context: LaneContext }) {
  const request = useQuery(bookRequestQuery(id));
  if (request.data === undefined) {
    return request.isPending ? (
      <Loading kind="section" label="Reading this request…" />
    ) : null;
  }
  return <Lane request={request.data} context={context} main={false} />;
}

/** A book's requests: the book above, a lane for the request asked for and each other one still going, and the book's history below. Shared by the book's request page and the Requests list's detail pane; `focusTitle` moves focus to the book's title once it shows. */
export function RequestDossier({
  uuid,
  id,
  variant,
  focusTitle = false,
}: {
  uuid: BookUuid;
  id: number;
  variant: DossierVariant;
  focusTitle?: boolean;
}) {
  const book = useQuery(bookQuery(uuid));
  const request = useQuery(bookRequestQuery(id));
  const listed = useQuery(bookRequestsQuery(uuid));
  // shortcut: the merged list holds the newest 1000 wished books; a book past them reads as unwished.
  const wishlists = useQuery(wishlistBooksQuery("all"));
  const viewer = useCurrentUser();
  const { state } = useLocation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shown = book.data !== undefined && request.data !== undefined;
  useEffect(() => {
    if (focusTitle && shown) titleRef.current?.focus();
  }, [focusTitle, shown]);
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
  // Unknown until the wishlists answer: the clause stays out rather than claiming nobody.
  const wanted = wishlists.data?.find((w) => w.uuid === uuid)?.wantedBy;
  const wishers = wanted ? wishersLine(wanted, viewer.id) : null;
  const split = listed.data && splitBookRequests(listed.data, id);
  const context: LaneContext = {
    book: book.data,
    listings: listed.data,
    variant,
  };
  const Title = variant === "page" ? "h1" : "h2";
  const from = variant === "page" ? cameFrom(state) : null;
  return (
    <div
      className="rq-page"
      data-variant={variant}
      data-testid={variant === "page" ? "request-page" : "requests-pane"}
    >
      {variant === "page" && <PageTitle page={`Request ${title}`} />}
      {from === "requests" && (
        <Link className="rq-back" to="/requests">
          ‹ Requests
        </Link>
      )}
      {from === "wishlists" && (
        <Link className="rq-back" to="/wishlists">
          ← Back to Wishlists
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
          <Title
            ref={titleRef}
            tabIndex={-1}
            className="rq-title"
            data-testid="request-title"
          >
            {title}
          </Title>
          {(authors.length > 0 || wishers) && (
            <p className="rq-author" data-testid="request-byline">
              {authors.length > 0 && <span>{authors.join(", ")}</span>}
              {authors.length > 0 && wishers && (
                <span className="rq-byline-sep"> · </span>
              )}
              {wishers && <span className="rq-wishers">{wishers}</span>}
            </p>
          )}
        </div>
        <Link className="rq-open" to={back}>
          Open book page
        </Link>
      </header>
      <Lane
        key={request.data.id}
        request={request.data}
        context={context}
        main
      />
      {split?.lanes.map((other) => (
        <OtherLane
          key={other.request.id}
          id={other.request.id}
          context={context}
        />
      ))}
      <RequestHistory
        listed={listed}
        history={split?.history}
        variant={variant}
      />
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
