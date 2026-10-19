import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  type BookDetail,
  type BookUuid,
  parseBookUuid,
  saveReadingPosition,
} from "../../api";
import { useAutoReadStatus } from "../../autoReadStatus";
import { classes } from "../../classes";
import { Loading } from "../../components/Loading/Loading";
import { PageNotFound } from "../../components/PageState/PageState";
import { useReadingSession } from "../../readingSession";
import { bookQuery, progressQuery } from "../BookDetail/queries";
import { comicPageAnchor, comicStartPage, pagePercent } from "./pager";
import "./ComicReader.css";

export type Fit = "width" | "height";

type FitButtonProps = {
  fit: Fit;
  mode: Fit;
  testId: string;
  onSelect: (mode: Fit) => void;
};

/** One fit-mode toggle; `aria-pressed` makes the pair a toggle group. */
export function FitButton({ fit, mode, testId, onSelect }: FitButtonProps) {
  const active = fit === mode;
  return (
    <button
      type="button"
      className={classes("cr-btn", "cr-fit", active && "active")}
      data-testid={testId}
      aria-pressed={active}
      onClick={() => onSelect(mode)}
    >
      Fit {mode}
    </button>
  );
}

// Spelled out: the CSS extractor reads class names from string literals.
const STAGE_CLASS = {
  width: "cr-stage cr-fit-width",
  height: "cr-stage cr-fit-height",
} satisfies Record<Fit, string>;

const pageSrc = (uuid: BookUuid, page: number) =>
  `/api/ebooks/${encodeURIComponent(uuid)}/pages/${page}`;

function Pager({ uuid }: { uuid: BookUuid }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const cameFromApp = useLocation().key !== "default";
  const root = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState<BookDetail | "failed" | null>(null);
  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<Fit>("height");

  useEffect(() => root.current?.focus(), []);

  // Fetched fresh on every open: a stale position would resume at the wrong page.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.fetchQuery({ ...bookQuery(uuid), staleTime: 0 }),
      client
        .fetchQuery({ ...progressQuery(uuid), staleTime: 0 })
        .catch(() => null),
    ]).then(
      ([found, progress]) => {
        if (cancelled) return;
        if (!found) return setBook("failed");
        const saved = progress?.reading;
        setPage(
          comicStartPage(
            saved?.cfi ?? null,
            saved?.percent ?? null,
            found.pageCount ?? 0,
          ),
        );
        setBook(found);
      },
      () => {
        if (!cancelled) setBook("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, uuid]);

  const loaded = book !== null && book !== "failed";
  const count = loaded ? (book.pageCount ?? 0) : 0;

  useReadingSession(uuid);
  useAutoReadStatus(uuid, count > 0 && page + 1 === count);

  // Every control funnels through here, so a page is never shown without being saved.
  function goto(target: number) {
    if (count === 0) return;
    const next = Math.min(Math.max(target, 0), count - 1);
    if (next === page) return;
    setPage(next);
    // Best-effort: a failed write must not interrupt reading, and the next turn retries.
    saveReadingPosition(uuid, {
      anchor: comicPageAnchor(next),
      percent: pagePercent(next, count),
    }).catch(() => {});
  }

  function back() {
    if (cameFromApp) navigate(-1);
    else navigate(`/books/${uuid}`);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pager takes arrow keys while it holds focus
    <div
      ref={root}
      className="cr-root"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus lands here so the arrow keys work at once
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") goto(page + 1);
        if (e.key === "ArrowLeft") goto(page - 1);
      }}
    >
      <header className="cr-top">
        <button
          type="button"
          className="cr-btn cr-back"
          data-testid="comic-back"
          aria-label="Back"
          onClick={back}
        >
          ‹
        </button>
        <div className="cr-title-block">
          <h1 className="cr-title">{loaded ? book.title : ""}</h1>
          {loaded && book.authors[0] && (
            <span className="cr-author">{book.authors[0]}</span>
          )}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width the cr rules never reset */}
        <div className="cr-fit-controls" role="group" aria-label="Fit mode">
          <FitButton
            fit={fit}
            mode="width"
            testId="comic-fit-width"
            onSelect={setFit}
          />
          <FitButton
            fit={fit}
            mode="height"
            testId="comic-fit-height"
            onSelect={setFit}
          />
        </div>
      </header>
      {book === "failed" || (loaded && count === 0) ? (
        <div className="cr-state" data-testid="comic-error" role="alert">
          This comic could not be opened.
        </div>
      ) : !loaded ? (
        <Loading
          kind="stage"
          className="in-flow cr-loading"
          testId="comic-loading"
          label="Taking it off the shelf"
        />
      ) : (
        <>
          <div className={STAGE_CLASS[fit]} data-testid="comic-stage">
            <button
              type="button"
              className="cr-nav cr-nav-prev"
              data-testid="comic-prev"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => goto(page - 1)}
            >
              ‹
            </button>
            <img
              key={page}
              className="cr-page"
              data-testid="comic-page-image"
              src={pageSrc(uuid, page)}
              alt={`Page ${page + 1}`}
            />
            <button
              type="button"
              className="cr-nav cr-nav-next"
              data-testid="comic-next"
              aria-label="Next page"
              disabled={page + 1 >= count}
              onClick={() => goto(page + 1)}
            >
              ›
            </button>
            {/* The neighbours warm the browser cache; ETag revalidation makes the real fetch a 304. */}
            {page + 1 < count && (
              <img
                className="cr-prefetch"
                aria-hidden="true"
                alt=""
                src={pageSrc(uuid, page + 1)}
              />
            )}
            {page > 0 && (
              <img
                className="cr-prefetch"
                aria-hidden="true"
                alt=""
                src={pageSrc(uuid, page - 1)}
              />
            )}
          </div>
          <footer className="cr-bottom" data-testid="comic-footer">
            <input
              className="cr-slider"
              data-testid="comic-slider"
              type="range"
              min={0}
              max={count - 1}
              value={page}
              aria-label="Page slider"
              onChange={(e) => goto(e.currentTarget.valueAsNumber)}
              // A focused slider steps itself; bubbling would turn the page twice.
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="cr-page-label">
              Page {page + 1} of {count}
            </span>
            <div className="cr-ribbon">
              <i style={{ width: `${pagePercent(page, count)}%` }} />
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

export function ComicReader() {
  const uuid = parseBookUuid(useParams().uuid);
  return uuid ? (
    <Pager key={uuid} uuid={uuid} />
  ) : (
    <PageNotFound subject="Book" />
  );
}
