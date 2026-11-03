import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
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
import { useCurrentUser } from "../../session";
import { bookQuery } from "../BookDetail/queries";
import { stateView, versionFormat, versionSize } from "./requestView";
import "./BookRequest.css";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

/** One version found: its format and size, a Best match badge, Details, and Choose. */
function VersionRow({
  version,
  busy,
  onChoose,
}: {
  version: RequestVersion;
  busy: boolean;
  onChoose: () => void;
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
        <Button
          variant={version.bestMatch ? "primary" : "default"}
          size="sm"
          data-testid="request-choose"
          aria-label={`Choose the ${format} version${size ? `, ${size}` : ""}`}
          disabled={busy}
          onClick={onChoose}
        >
          Choose
        </Button>
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

function Choices({ request }: { request: Request }) {
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
          busy={choose.isPending}
          onChoose={() => choose.mutate(version.id)}
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

function Stuck({ request }: { request: Request }) {
  const viewer = useCurrentUser();
  const toast = useToast();
  const answer = useAnswer(request.id);
  const retry = useMutation({
    mutationFn: () => retryBookRequest(request.id),
    onSuccess: answer,
    onError: (error) => toast(`Couldn’t try again: ${messageOf(error)}`),
  });
  return (
    <div className="rq-stuck">
      {request.stuckDetail && viewer.isAdmin && (
        <p className="rq-stuck-detail" data-testid="request-stuck-detail">
          {request.stuckDetail}
        </p>
      )}
      <Button
        variant="primary"
        data-testid="request-try-again"
        disabled={retry.isPending}
        aria-busy={retry.isPending}
        onClick={() => retry.mutate()}
      >
        <BusyLabel
          busy={retry.isPending}
          label="Try again"
          busyLabel="Trying…"
        />
      </Button>
    </div>
  );
}

/** The ebook lane: what became of the request, in the state's own words. */
function Lane({ request }: { request: Request }) {
  const { heading, note } = stateView(request.state);
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
          data-testid="request-state"
          data-state={request.state}
        >
          {heading}
        </p>
      </div>
      <p className="rq-note">{note}</p>
      {request.state === "looking" && (
        <Loading
          kind="section"
          label="Looking for versions…"
          testId="request-looking"
        />
      )}
      {request.state === "choose" && <Choices request={request} />}
      {request.state === "chosen" && <Chosen request={request} />}
      {request.state === "stuck" && <Stuck request={request} />}
    </section>
  );
}

function RequestPage({ uuid, id }: { uuid: BookUuid; id: number }) {
  const book = useQuery(bookQuery(uuid));
  const request = useQuery(bookRequestQuery(id));
  const back = `/books/${uuid}`;
  if (book.isPending || request.isPending) return <Loading kind="page" />;
  if (book.isError || request.isError) {
    const error = book.error ?? request.error;
    return (
      <PageError
        message={messageOf(error)}
        backTo={back}
        backLabel="Back to book"
      />
    );
  }
  if (!book.data) return <PageNotFound subject="Book" />;
  const { title, authors } = book.data;
  return (
    <main className="rq-page" data-testid="request-page">
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
    </main>
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
