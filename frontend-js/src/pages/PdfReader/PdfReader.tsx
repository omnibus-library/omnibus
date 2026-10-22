import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  type BookDetail,
  type BookUuid,
  type HighlightColor,
  parseBookUuid,
  saveReadingPosition,
} from "../../api";
import { useAutoReadStatus } from "../../autoReadStatus";
import { classes } from "../../classes";
import { Button } from "../../components/Button/Button";
import { Loading } from "../../components/Loading/Loading";
import { PageNotFound } from "../../components/PageState/PageState";
import { useReadingSession } from "../../readingSession";
import { pdfAnchorPage } from "../BookDetail/highlightAnchors";
import { bookQuery, progressQuery } from "../BookDetail/queries";
import {
  type Fit,
  FitButton,
  STAGE_CLASS,
  useBackToBook,
} from "../ComicReader/ComicReader";
import { pagePercent } from "../ComicReader/pager";
import { AnnotationTargets } from "../Reader/AnnotationTargets";
import type { AnnotationBridge } from "../Reader/annotations";
import { useHighlights } from "../Reader/annotations";
import { BookmarksDrawer } from "../Reader/BookmarksDrawer";
import { HighlightsDrawer } from "../Reader/HighlightsDrawer";
import { Icon } from "../Reader/ReaderChrome";
import { SelectionPopover } from "../Reader/SelectionPopover";
import { fileIdParam } from "../Reader/start";
import {
  deepLinkPage,
  paintList,
  pdfPageAnchor,
  pdfStartPage,
} from "./pdfAnchors";
import {
  loadPdfGlue,
  PDF_RUNTIME,
  type PdfSelection,
  parsePdfPosition,
  parsePdfSelection,
} from "./pdfGlue";
import "../ComicReader/ComicReader.css";
import "../Reader/Reader.css";
import "./PdfReader.css";

const HOST_ID = "omnibus-pdf-page";

type Status = "loading" | "ready" | "failed";

// The glue calls these with a string; each one this page bridges is listed here.
const HOOKS = [
  "__omnibusOnPdfReady",
  "__omnibusOnPdfPage",
  "__omnibusOnPdfError",
  "__omnibusOnPdfSelection",
  "__omnibusOnPdfSelectionCleared",
  "__omnibusOnPdfHighlightTap",
] as const;

/** The highlights drawer and the bookmarks drawer share the toolbar; opening one closes the other. */
type Panel = "highlights" | "bookmarks";

// Painting is list-driven (the page pushes the whole set), so only a jump and a copy reach the glue.
const pdfBridge: AnnotationBridge = {
  navigate(anchor) {
    const page = pdfAnchorPage(anchor);
    if (page !== null) window.OmnibusPdfReader?.goTo(page);
  },
  canNavigate: (anchor) => pdfAnchorPage(anchor) !== null,
  paint() {},
  unpaint() {},
  copy: (text) => window.OmnibusPdfReader?.copyText(text),
};

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
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const {
    highlights,
    held,
    target,
    setTarget,
    load,
    markFailed,
    create,
    saveNote,
    rowActions,
  } = useHighlights(uuid, pdfBridge);
  // Retry re-runs the whole open: the fetch, the glue load and the mount.
  const [attempt, setAttempt] = useState(0);
  // The page whose position was last posted, so an echo never re-stamps an unmoved position.
  const lastSaved = useRef<number | null>(null);
  const fitNow = useRef(fit);
  fitNow.current = fit;
  // The glue's hooks outlive a render, so they read the list through this.
  const highlightsNow = useRef(held);
  highlightsNow.current = held;

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
    setSelection(null);
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
      // The paint effect may have run before the glue could draw.
      window.OmnibusPdfReader?.paintHighlights(
        paintList(highlightsNow.current),
      );
    };
    const onPage = (json: string) => {
      const position = parsePdfPosition(json);
      if (!position) return;
      setCount(position.pageCount);
      setPage(position.page);
      save(position.page, position.pageCount);
    };
    // A failed open leaves the highlights drawer saying so rather than spinning.
    const fail = (message: string | null) => {
      setError(message);
      setStatus("failed");
      markFailed();
    };
    const hooks = {
      __omnibusOnPdfReady: onReady,
      __omnibusOnPdfPage: onPage,
      __omnibusOnPdfError: fail,
      __omnibusOnPdfSelection(json: string) {
        const picked = parsePdfSelection(json);
        if (picked) setSelection(picked);
      },
      // The only dismiss on phones, where the popover has no scrim to tap.
      __omnibusOnPdfSelectionCleared: () => setSelection(null),
      // Only for an anchor the list holds, so a stale paint can't open an empty drawer.
      __omnibusOnPdfHighlightTap(anchor: string) {
        if (highlightsNow.current.some((h) => h.anchor === anchor)) {
          setPanel("highlights");
        }
      },
    } satisfies Record<(typeof HOOKS)[number], (json: string) => void>;
    for (const name of HOOKS) window[name] = hooks[name];

    const open = async () => {
      const [found, progress] = await Promise.all([
        client.fetchQuery({ ...bookQuery(uuid), staleTime: 0 }),
        // A failed fetch fails the open, as the book's does: it must not read as "nothing saved".
        // A deep link needs no saved position.
        deepLink !== null
          ? null
          : client.fetchQuery({ ...progressQuery(uuid), staleTime: 0 }),
      ]);
      if (cancelled) return;
      if (!found) return fail(null);
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
      if (!glue) return fail("glue failed to load");
      const url = `/api/ebooks/${encodeURIComponent(uuid)}/file`;
      window.OmnibusPdfReader?.init(HOST_ID, {
        url: fileId === null ? url : `${url}?file_id=${fileId}`,
        ...PDF_RUNTIME,
        startPage: start,
        fit: fitNow.current,
      });
      if (!cancelled) await load(() => cancelled);
    };
    open().catch(() => {
      if (!cancelled) fail(null);
    });

    return () => {
      cancelled = true;
      for (const name of HOOKS) {
        if (window[name] === hooks[name]) delete window[name];
      }
      window.OmnibusPdfReader?.destroy();
    };
  }, [client, uuid, fileId, deepLink, attempt, save, load, markFailed]);

  useEffect(() => {
    window.OmnibusPdfReader?.setFit(fit);
  }, [fit]);

  useEffect(() => {
    window.OmnibusPdfReader?.paintHighlights(paintList(held));
  }, [held]);

  const dismissSelection = () => {
    setSelection(null);
    window.OmnibusPdfReader?.clearSelection();
  };
  // Opening one tool closes the other.
  const toggle = (tool: Panel) => {
    setTarget(null);
    setPanel((open) => (open === tool ? null : tool));
  };
  function highlightSelection(
    picked: PdfSelection,
    color: HighlightColor,
    after: "note" | "quote" | null,
  ) {
    dismissSelection();
    create({ anchor: picked.anchor, color, text: picked.text }, after);
  }
  const rows = rowActions(
    () => setPanel(null),
    () => root.current?.focus(),
  );

  // Every control funnels through here, so a page is never shown without being saved.
  function goto(to: number) {
    if (count === 0) return;
    const next = Math.min(Math.max(to, 0), count - 1);
    if (next === page) return;
    setSelection(null);
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
        if (e.key === "Escape") {
          if (selection) dismissSelection();
          else if (target) setTarget(null);
          else if (panel) setPanel(null);
          else window.OmnibusPdfReader?.clearSelection();
          return;
        }
        // The note composer keeps its arrow keys.
        if (e.target instanceof HTMLElement && e.target.closest("textarea")) {
          return;
        }
        if (e.key === "ArrowRight") goto(page + 1);
        if (e.key === "ArrowLeft") goto(page - 1);
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
            className={classes(
              "cr-btn cr-fit pr-tool",
              panel === "highlights" && "active",
            )}
            data-testid="pdf-highlights"
            aria-label="Highlights and notes"
            aria-pressed={panel === "highlights"}
            onClick={() => toggle("highlights")}
          >
            <Icon size={17}>
              <path d="M4 19.5l1.6-4 8.2-8.2 3 3-8.2 8.2-4.6 0z" />
              <path d="M13.2 6.1l2.7-2.7a1.3 1.3 0 0 1 1.9 0l1.8 1.8a1.3 1.3 0 0 1 0 1.9l-2.7 2.7" />
            </Icon>
            {held.length > 0 && <span className="rd-badge">{held.length}</span>}
          </button>
          <button
            type="button"
            className={classes(
              "cr-btn cr-fit pr-tool",
              panel === "bookmarks" && "active",
            )}
            data-testid="pdf-bookmarks"
            aria-label="Bookmarks"
            aria-pressed={panel === "bookmarks"}
            onClick={() => toggle("bookmarks")}
          >
            <Icon size={17}>
              <path d="M7 4h10v16l-5-3.6L7 20V4z" />
            </Icon>
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
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          onDismiss={dismissSelection}
          onHighlight={(color) => highlightSelection(selection, color, null)}
          onNote={() => highlightSelection(selection, "amber", "note")}
          onQuote={() => highlightSelection(selection, "amber", "quote")}
          onCopy={() => {
            pdfBridge.copy(selection.text);
            dismissSelection();
          }}
          onShare={() => {
            window.OmnibusPdfReader?.shareText(selection.text);
            dismissSelection();
          }}
        />
      )}
      {panel === "highlights" && (
        <HighlightsDrawer highlights={highlights} {...rows} />
      )}
      {panel === "bookmarks" && (
        <BookmarksDrawer
          uuid={uuid}
          position={count > 0 ? pdfPageAnchor(page) : null}
          label={`Page ${page + 1}`}
          bridge={pdfBridge}
          onClose={() => setPanel(null)}
        />
      )}
      <AnnotationTargets
        target={target}
        book={book}
        onSave={saveNote}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

export function PdfReader() {
  const uuid = parseBookUuid(useParams().uuid);
  const [search] = useSearchParams();
  const fileId = fileIdParam(search);
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
