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
import { nowSecs, plural } from "../../format";
import { useCurrentUser } from "../../session";
import { bookQuery } from "../BookDetail/queries";
import {
  firstShown,
  isCancellable,
  isDownloading,
  isSearchStale,
  pickedMeta,
  progressPercent,
  requestPath,
  SEARCH_STALE_AFTER_SECS,
  stateView,
  versionSource,
} from "./requestView";
import { messageOf, useAnswer, useCancel, useSwap } from "./useRequestActions";
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
          disabled={locked}
          onClick={onChoose}
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
  const found = request.versions.length;
  const shown = all ? request.versions : firstShown(request.versions);
  const hidden = found - firstShown(request.versions).length;
  return (
    <>
      {request.note && (
        <p className="rq-note" data-testid="request-note">
          {request.note}
        </p>
      )}
      <p className="rq-found" data-testid="request-versions-found">
        {`${found} version${plural(found)} found · Best match first`}
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
          <Button
            variant="ghost"
            size="sm"
            data-testid="request-show-more"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `Show ${hidden} more`}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          data-testid="request-details-toggle"
          aria-expanded={details}
          aria-controls={listId}
          onClick={() => setDetails(!details)}
        >
          Details
        </Button>
      </div>
    </>
  );
}

/** The version picked, named as its row named it: the release name over its size and source. */
function Picked({ request }: { request: Request }) {
  const picked = request.versions.find((v) => v.id === request.chosenResultId);
  const meta = picked ? pickedMeta(picked) : "";
  return (
    <div className="rq-picked" data-testid="request-chosen">
      <p className="rq-version-name">{picked ? picked.title : "Your pick"}</p>
      {meta && <p className="rq-version-meta">{meta}</p>}
    </div>
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
      answer(tried);
      onTried();
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

/** The ebook lane: what became of the request, in the state's own words. */
function Lane({ request }: { request: Request }) {
  const viewer = useCurrentUser();
  // Held here: a cancelled request has no Cancel button left, but its Undo toast still needs this.
  const title = useRef<HTMLHeadingElement>(null);
  const focusTitle = () => title.current?.focus();
  const cancel = useCancel(request.id, focusTitle);
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
      {(request.state === "chosen" || request.state === "on_its_way") && (
        <Picked request={request} />
      )}
      {request.state === "on_its_way" && <Downloading request={request} />}
      {request.state === "stuck" && (
        <Stuck request={request} canAct={canAct} onTried={focusTitle} />
      )}
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
