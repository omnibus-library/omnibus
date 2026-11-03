import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
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
  isSearchStale,
  requestPath,
  SEARCH_STALE_AFTER_SECS,
  stateView,
  versionFormat,
  versionSize,
} from "./requestView";
import "./BookRequest.css";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

/** One version found: its format and size, a Best match badge, Details, and Choose. */
function VersionRow({
  version,
  choosing,
  locked,
  onChoose,
}: {
  version: RequestVersion;
  /** This is the version being chosen. */
  choosing: boolean;
  /** Some version is being chosen, so no other can be. */
  locked: boolean;
  /** Absent when the viewer may not pick for this request. */
  onChoose: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const format = versionFormat(version.format);
  const size = versionSize(version.sizeBytes);
  return (
    <li
      className="rq-version"
      data-testid="request-version"
      data-best-match={version.bestMatch}
    >
      <div className="rq-version-main">
        <span className="rq-format">{format}</span>
        <span className="rq-size">{size ?? "Size unknown"}</span>
        {version.bestMatch && (
          <span className="rq-best" data-testid="request-best-match">
            Best match
          </span>
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
        {onChoose && (
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

/** Replaces the cached request with the server's latest answer to a write, so polling follows the new state. */
function useAnswer(id: number) {
  const client = useQueryClient();
  return (request: Request) =>
    client.setQueryData(bookRequestQuery(id).queryKey, request);
}

function Choices({ request, canAct }: { request: Request; canAct: boolean }) {
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
    <ul className="rq-versions" aria-label="Versions found">
      {request.versions.map((version) => (
        <VersionRow
          key={version.id}
          version={version}
          choosing={choose.isPending && choose.variables === version.id}
          locked={choose.isPending}
          onChoose={canAct ? () => choose.mutate(version.id) : null}
        />
      ))}
    </ul>
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
        <h2 id="rq-lane-title" className="rq-lane-title">
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
        <Choices request={request} canAct={canAct} />
      )}
      {request.state === "chosen" && <Chosen request={request} />}
      {request.state === "stuck" && <Stuck request={request} canAct={canAct} />}
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
      <Lane request={request.data} />
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
