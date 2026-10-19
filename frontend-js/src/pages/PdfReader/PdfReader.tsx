import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  type BookDetail,
  type BookUuid,
  parseBookUuid,
  saveReadingPosition,
} from "../../api";
import { useAutoReadStatus } from "../../autoReadStatus";
import { Button } from "../../components/Button/Button";
import { Loading } from "../../components/Loading/Loading";
import { PageNotFound } from "../../components/PageState/PageState";
import { useReadingSession } from "../../readingSession";
import { bookQuery, progressQuery } from "../BookDetail/queries";
import {
  type Fit,
  FitButton,
  STAGE_CLASS,
  useBackToBook,
} from "../ComicReader/ComicReader";
import { pagePercent } from "../ComicReader/pager";
import { deepLinkPage, pdfPageAnchor, pdfStartPage } from "./pdfAnchors";
import { loadPdfGlue, PDF_RUNTIME, parsePdfPosition } from "./pdfGlue";
import "../ComicReader/ComicReader.css";
import "./PdfReader.css";

const HOST_ID = "omnibus-pdf-page";

type Status = "loading" | "ready" | "failed";

const ICON = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function PdfPage({
  uuid,
  fileId,
  deepLink,
}: {
  uuid: BookUuid;
  fileId: number | null;
  deepLink: number | null;
}) {
  const client = useQueryClient();
  const back = useBackToBook(uuid);
  const root = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // PDF.js's own page count, authoritative over the indexed one; 0 until the document opens.
  const [count, setCount] = useState(0);
  const [fit, setFit] = useState<Fit>("height");
  // Retry re-runs the whole open: the fetch, the glue load and the mount.
  const [attempt, setAttempt] = useState(0);
  // The page whose position was last posted, so an echo never re-stamps an unmoved position.
  const lastSaved = useRef<number | null>(null);
  const fitNow = useRef(fit);
  fitNow.current = fit;

  // Best-effort: a failed write must not interrupt reading, and the next turn retries.
  const save = useCallback(
    (target: number, total: number) => {
      if (lastSaved.current === target || total === 0) return;
      lastSaved.current = target;
      saveReadingPosition(uuid, {
        anchor: pdfPageAnchor(target),
        percent: pagePercent(target, total),
      }).catch(() => {});
    },
    [uuid],
  );

  useReadingSession(uuid);
  useAutoReadStatus(uuid, count > 0 && page + 1 === count);

  useEffect(() => root.current?.focus(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry bumps `attempt` to run the open again
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    setCount(0);
    lastSaved.current = null;

    const onReady = (json: string) => {
      const position = parsePdfPosition(json);
      if (position) {
        setCount(position.pageCount);
        setPage(position.page);
        // The opening report restates where we resumed; it is not a new position.
        lastSaved.current = position.page;
      }
      setStatus("ready");
    };
    const onPage = (json: string) => {
      const position = parsePdfPosition(json);
      if (!position) return;
      setCount(position.pageCount);
      setPage(position.page);
      save(position.page, position.pageCount);
    };
    const onError = (message: string) => {
      setError(message);
      setStatus("failed");
    };
    window.__omnibusOnPdfReady = onReady;
    window.__omnibusOnPdfPage = onPage;
    window.__omnibusOnPdfError = onError;

    const open = async () => {
      const [found, progress] = await Promise.all([
        client.fetchQuery({ ...bookQuery(uuid), staleTime: 0 }),
        client
          .fetchQuery({ ...progressQuery(uuid), staleTime: 0 })
          .catch(() => null),
      ]);
      if (cancelled) return;
      if (!found) return setStatus("failed");
      const saved = progress?.reading;
      const start = pdfStartPage(
        deepLink,
        saved?.cfi ?? null,
        saved?.percent ?? null,
        found.pageCount ?? 0,
      );
      setBook(found);
      setPage(start);
      const glue = await loadPdfGlue().then(
        () => true,
        () => false,
      );
      if (cancelled) return;
      if (!glue) return onError("glue failed to load");
      const url = `/api/ebooks/${encodeURIComponent(uuid)}/file`;
      window.OmnibusPdfReader?.init(HOST_ID, {
        url: fileId === null ? url : `${url}?file_id=${fileId}`,
        ...PDF_RUNTIME,
        startPage: start,
        fit: fitNow.current,
      });
    };
    open().catch(() => {
      if (!cancelled) setStatus("failed");
    });

    return () => {
      cancelled = true;
      if (window.__omnibusOnPdfReady === onReady) {
        delete window.__omnibusOnPdfReady;
      }
      if (window.__omnibusOnPdfPage === onPage) {
        delete window.__omnibusOnPdfPage;
      }
      if (window.__omnibusOnPdfError === onError) {
        delete window.__omnibusOnPdfError;
      }
      window.OmnibusPdfReader?.destroy();
    };
  }, [client, uuid, fileId, deepLink, attempt, save]);

  useEffect(() => {
    window.OmnibusPdfReader?.setFit(fit);
  }, [fit]);

  // Every control funnels through here, so a page is never shown without being saved.
  function goto(target: number) {
    if (count === 0) return;
    const next = Math.min(Math.max(target, 0), count - 1);
    if (next === page) return;
    setPage(next);
    save(next, count);
    window.OmnibusPdfReader?.goTo(next);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the reader takes arrow keys while it holds focus
    <div
      ref={root}
      className="cr-root pr-root"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus lands here so the arrow keys work at once
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") goto(page + 1);
        if (e.key === "ArrowLeft") goto(page - 1);
        if (e.key === "Escape") window.OmnibusPdfReader?.clearSelection();
      }}
    >
      <header className="cr-top">
        <button
          type="button"
          className="cr-btn cr-back"
          data-testid="pdf-back"
          aria-label="Back"
          onClick={back}
        >
          ‹
        </button>
        <div className="cr-title-block">
          <h1 className="cr-title">{book?.title ?? ""}</h1>
          {book?.authors[0] && (
            <span className="cr-author">{book.authors[0]}</span>
          )}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width the cr rules never reset */}
        <div className="cr-fit-controls" role="group" aria-label="Annotations">
          <button
            type="button"
            className="cr-btn cr-fit pr-tool"
            data-testid="pdf-highlights"
            aria-label="Highlights and notes"
            aria-pressed={false}
          >
            <svg {...ICON} aria-hidden="true">
              <path d="M4 19.5l1.6-4 8.2-8.2 3 3-8.2 8.2-4.6 0z" />
              <path d="M13.2 6.1l2.7-2.7a1.3 1.3 0 0 1 1.9 0l1.8 1.8a1.3 1.3 0 0 1 0 1.9l-2.7 2.7" />
            </svg>
          </button>
          <button
            type="button"
            className="cr-btn cr-fit pr-tool"
            data-testid="pdf-bookmarks"
            aria-label="Bookmarks"
            aria-pressed={false}
          >
            <svg {...ICON} aria-hidden="true">
              <path d="M7 4h10v16l-5-3.6L7 20V4z" />
            </svg>
          </button>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width the cr rules never reset */}
        <div className="cr-fit-controls" role="group" aria-label="Fit mode">
          <FitButton
            fit={fit}
            mode="width"
            testId="pdf-fit-width"
            onSelect={setFit}
          />
          <FitButton
            fit={fit}
            mode="height"
            testId="pdf-fit-height"
            onSelect={setFit}
          />
        </div>
      </header>
      <div className={`${STAGE_CLASS[fit]} pr-stage`} data-testid="pdf-stage">
        <button
          type="button"
          className="cr-nav cr-nav-prev"
          data-testid="pdf-prev"
          aria-label="Previous page"
          disabled={page === 0 || status !== "ready"}
          onClick={() => goto(page - 1)}
        >
          ‹
        </button>
        {/* PDF.js draws the canvas, highlight layer and text layer in here. */}
        <div id={HOST_ID} className="pr-host" data-testid="pdf-page-host" />
        <button
          type="button"
          className="cr-nav cr-nav-next"
          data-testid="pdf-next"
          aria-label="Next page"
          disabled={count === 0 || page + 1 >= count}
          onClick={() => goto(page + 1)}
        >
          ›
        </button>
        {status === "loading" && (
          <Loading
            kind="stage"
            className="pr-overlay"
            testId="pdf-loading"
            label="Setting the page"
          />
        )}
        {status === "failed" && (
          <div
            className="cr-state pr-overlay"
            data-testid="pdf-error"
            role="alert"
          >
            <p>This PDF could not be opened.</p>
            {error && (
              <p className="pr-error-detail" data-testid="pdf-error-detail">
                {error}
              </p>
            )}
            <Button
              size="sm"
              data-testid="pdf-retry"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </Button>
          </div>
        )}
      </div>
      <footer className="cr-bottom" data-testid="pdf-footer">
        <input
          className="cr-slider"
          data-testid="pdf-slider"
          type="range"
          min={0}
          max={Math.max(count - 1, 0)}
          value={page}
          disabled={count === 0}
          aria-label="Page slider"
          onChange={(e) => goto(e.currentTarget.valueAsNumber)}
          // A focused slider steps itself; bubbling would turn the page twice.
          onKeyDown={(e) => e.stopPropagation()}
        />
        <span className="cr-page-label" data-testid="pdf-page-label">
          {count > 0 ? `Page ${page + 1} of ${count}` : "—"}
        </span>
        <div className="cr-ribbon">
          <i style={{ width: `${pagePercent(page, count)}%` }} />
        </div>
      </footer>
    </div>
  );
}

export function PdfReader() {
  const uuid = parseBookUuid(useParams().uuid);
  const [search] = useSearchParams();
  const fileParam = search.get("file_id");
  const fileId =
    fileParam !== null && /^\d+$/.test(fileParam) ? Number(fileParam) : null;
  const deepLink = deepLinkPage(search.get("page"));
  if (!uuid) return <PageNotFound subject="Book" />;
  return (
    <PdfPage
      key={`${uuid}|${fileId}|${deepLink}`}
      uuid={uuid}
      fileId={fileId}
      deepLink={deepLink}
    />
  );
}
