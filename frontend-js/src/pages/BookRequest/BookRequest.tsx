import { useMutation, useQuery } from "@tanstack/react-query";
import { type Ref, useEffect, useId, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import {
  type BookUuid,
  bookRequestQuery,
  chooseRequestVersion,
  parseBookUuid,
  positiveInt,
  type BookRequest as Request,
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
import { nowSecs } from "../../format";
import { useCurrentUser } from "../../session";
import { bookQuery } from "../BookDetail/queries";
import {
  isCancellable,
  isDownloading,
  isSearchStale,
  progressPercent,
  requestPath,
  SEARCH_STALE_AFTER_SECS,
  stateView,
  versionFormat,
  versionSize,
} from "./requestView";
import { messageOf, useAnswer, useCancel, useSwap } from "./useRequestActions";
import "./BookRequest.css";

/** One version found: its format and size, a Best match badge, Details, and Choose. */
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
        <span className="rq-format">{format}</span>
        <span className="rq-size">{size ?? "Size unknown"}</span>
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
            aria-label={`Choose the ${format} version${size ? `, ${size}` : ""}`}
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

/** The one bar for a download: a native progress element, labelled, with its percent beside it. Before the client has reported, the bar has no value and no percent. */
function Downloading({ request }: { request: Request }) {
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

/** Cancel while a request is still going, and Pick another while its version downloads; one at a time. */
function Actions({
  request,
  cancel,
  swap,
}: {
  request: Request;
  cancel: ReturnType<typeof useCancel>;
  swap: ReturnType<typeof useSwap>;
}) {
  const busy = cancel.isPending || swap.isPending;
  return (
    <div className="rq-actions">
      {isDownloading(request) && (
        <Button
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
            label="Pick another"
            busyLabel="Picking…"
          />
        </Button>
      )}
      <Button
        variant="ghost"
        data-testid="request-cancel"
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

/** Searches again for the request; the one way out of a search that came up empty or never ended. */
function TryAgain({ request }: { request: Request }) {
  const toast = useToast();
  const answer = useAnswer(request.id);
  const retry = useMutation({
    mutationFn: () => retryBookRequest(request.id),
    onSuccess: answer,
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

function Stuck({ request, canAct }: { request: Request; canAct: boolean }) {
  return (
    <div className="rq-stuck">
      {request.stuckDetail && (
        <p className="rq-stuck-detail" data-testid="request-stuck-detail">
          {request.stuckDetail}
        </p>
      )}
      {canAct && <TryAgain request={request} />}
    </div>
  );
}

/** Whether a search that began at `updatedAt` should have ended by now; re-checked when it would turn so. */
function useSearchStale(updatedAt: number) {
  const [now, setNow] = useState(nowSecs);
  useEffect(() => {
    const wait = updatedAt + SEARCH_STALE_AFTER_SECS - nowSecs();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(nowSecs()), (wait + 1) * 1000);
    return () => clearTimeout(timer);
  }, [updatedAt]);
  return isSearchStale(updatedAt, now);
}

/** The wait for a search, with a way out once it has run past its timeout. */
function Looking({ request, canAct }: { request: Request; canAct: boolean }) {
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
          <TryAgain request={request} />
        </div>
      )}
    </>
  );
}

/** The ebook lane: what became of the request, in the state's own words. */
function Lane({ request }: { request: Request }) {
  const viewer = useCurrentUser();
  // Held here: a cancelled request has no Cancel button left, but its Undo toast still needs this.
  const title = useRef<HTMLHeadingElement>(null);
  const cancel = useCancel(request.id, () => title.current?.focus());
  const [focusVersions, setFocusVersions] = useState(false);
  const swap = useSwap(request.id, () => setFocusVersions(true));
  // Anyone may read a request; only its maker, or an admin, may act on it.
  const canAct = viewer.id === request.userId || viewer.isAdmin;
  const { heading, note } = stateView(request.state, request.stuckReason);
  return (
    <section
      className="rq-panel rq-lane"
      aria-labelledby="rq-lane-title"
      data-testid="request-lane-ebook"
    >
      <div className="rq-lane-head">
        <h2
          ref={title}
          tabIndex={-1}
          id="rq-lane-title"
          className="rq-lane-title"
        >
          Ebook
        </h2>
        <p
          className="rq-state"
          role="status"
          data-testid="request-state"
          data-state={request.state}
        >
          {heading}
        </p>
      </div>
      <p className="rq-note">{note}</p>
      {request.state === "looking" && (
        <Looking request={request} canAct={canAct} />
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
      {request.state === "on_its_way" && <Downloading request={request} />}
      {request.state === "stuck" && <Stuck request={request} canAct={canAct} />}
      {canAct && isCancellable(request) && (
        <Actions request={request} cancel={cancel} swap={swap} />
      )}
    </section>
  );
}

function RequestPage({ uuid, id }: { uuid: BookUuid; id: number }) {
  const book = useQuery(bookQuery(uuid));
  const request = useQuery(bookRequestQuery(id));
  const back = `/books/${uuid}`;
  // A failed background poll keeps showing what was last read.
  if (book.data === undefined || request.data === undefined) {
    if (book.isPending || request.isPending) return <Loading kind="page" />;
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
  return (
    <div className="rq-page" data-testid="request-page">
      <PageTitle page={`Request ${title}`} />
      <header className="rq-head">
        <div className="rq-cover">
          <Cover
            book={book.data}
            src={book.data.hasCover ? thumbUrl(uuid) : null}
          />
        </div>
        <div className="rq-head-text">
          <p className="rq-eyebrow">Request</p>
          <h1 className="rq-title" data-testid="request-title">
            {title}
          </h1>
          {authors.length > 0 && (
            <p className="rq-author">{authors.join(", ")}</p>
          )}
          <Link className="rq-back" to={back}>
            Back to book
          </Link>
        </div>
      </header>
      <Lane key={request.data.id} request={request.data} />
    </div>
  );
}

/** A book's request page: the book above, one lane per format, ebook only for now. */
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
      <RequestPage uuid={uuid} id={id} />
    </ToastProvider>
  );
}
