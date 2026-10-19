import type { ReactNode } from "react";
import { classes } from "../../classes";
import { Button } from "../../components/Button/Button";
import { Loading } from "../../components/Loading/Loading";
import type { ReaderStatus } from "./relocate";

/** The one surface open over the page; opening a tool closes whichever was open. */
export type Panel =
  | "aa"
  | "toc"
  | "search"
  | "highlights"
  | "bookmarks"
  | "annotations";

function Icon({ size = 19, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type ToolProps = {
  testId: string;
  label: string;
  className?: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
};

function Tool({ testId, label, className, on, onClick, children }: ToolProps) {
  return (
    <button
      type="button"
      className={classes("rd-tool", className, on && "on")}
      data-testid={testId}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type TopBarProps = {
  bookTitle: string;
  chapterTitle: string;
  titleSub: string;
  panel: Panel | null;
  highlightCount: number;
  onBack: () => void;
  onToggle: (panel: Panel) => void;
};

/** Back, the title block and the tool row. */
export function TopBar(props: TopBarProps) {
  const { panel, onToggle } = props;
  const tool = (target: Panel) => ({
    on: panel === target,
    onClick: () => onToggle(target),
  });
  return (
    // The Aa panel's scrim covers the whole surface, so the bar lifts over it for Aa to close it.
    <div
      className={classes("rd-top", panel === "aa" && "rd-top-over-scrim")}
      data-testid="reader-top"
    >
      <button
        type="button"
        className="rd-tool"
        data-testid="reader-back"
        aria-label="Back to book"
        onClick={props.onBack}
      >
        <Icon>
          <path d="M15 5l-7 7 7 7" />
        </Icon>
      </button>
      <div className="rd-title-center">
        <span className="rd-title-book">{props.bookTitle}</span>
        {props.chapterTitle && (
          <>
            <span className="rd-title-sep">·</span>
            <span className="rd-title-ch" data-testid="reader-header-chapter">
              {props.chapterTitle}
            </span>
          </>
        )}
        {/* The phone stacks the title block and swaps the inline chapter for this. */}
        {props.titleSub && (
          <span className="rd-title-sub">{props.titleSub}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Tool testId="reader-toc" label="Contents" {...tool("toc")}>
          <Icon>
            <path d="M4 6h16M4 12h16M4 18h11" />
          </Icon>
        </Tool>
        <Tool testId="reader-search" label="Search in book" {...tool("search")}>
          <Icon>
            <circle cx="11" cy="11" r="6.2" />
            <path d="M20 20l-4.2-4.2" />
          </Icon>
        </Tool>
        <Tool
          testId="reader-aa"
          label="Display settings"
          className="rd-aa"
          {...tool("aa")}
        >
          Aa
        </Tool>
        <Tool
          testId="reader-highlights"
          label="Highlights and notes"
          className="rd-desktop-only"
          {...tool("highlights")}
        >
          <Icon>
            <path d="M4 19.5l1.6-4 8.2-8.2 3 3-8.2 8.2-4.6 0z" />
            <path d="M13.2 6.1l2.7-2.7a1.3 1.3 0 0 1 1.9 0l1.8 1.8a1.3 1.3 0 0 1 0 1.9l-2.7 2.7" />
          </Icon>
          {props.highlightCount > 0 && (
            <span className="rd-badge">{props.highlightCount}</span>
          )}
        </Tool>
        <Tool
          testId="reader-bookmark"
          label="Bookmarks"
          className="rd-desktop-only"
          {...tool("bookmarks")}
        >
          <Icon>
            <path d="M7 4h10v16l-5-3.6L7 20V4z" />
          </Icon>
        </Tool>
        {/* Highlights, notes and bookmarks in one sheet, in place of the two desktop buttons. */}
        <Tool
          testId="reader-annotations"
          label="Annotations"
          className="rd-phone-only"
          {...tool("annotations")}
        >
          <Icon>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </Icon>
        </Tool>
      </div>
    </div>
  );
}

/** The epub.js mount target, with the loading, error and nav-error surfaces over it. */
export function ViewerStage({
  status,
  onRetry,
}: {
  status: ReaderStatus;
  onRetry: () => void;
}) {
  return (
    <div className="rd-stage">
      <div
        id="omnibus-viewer"
        className="rd-viewer"
        data-testid="reader-viewer"
      />
      {status === "loading" && (
        <Loading
          kind="stage"
          className="rd-overlay"
          testId="reader-loading"
          label="Finding your place"
        />
      )}
      {status === "failed" && (
        <div
          className="rd-overlay rd-overlay-error"
          data-testid="reader-error"
          role="alert"
        >
          <p>This book couldn’t be loaded.</p>
          <Button size="sm" data-testid="reader-retry" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {status === "navFailed" && (
        <div
          className="rd-nav-error"
          data-testid="reader-nav-error"
          role="alert"
        >
          That section couldn’t be opened.
        </div>
      )}
    </div>
  );
}

/** The circular page-turn gutters. */
export function PageTurnGutters({
  onPrev,
  onNext,
}: {
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="rd-turn rd-turn-l"
        data-testid="reader-prev"
        aria-label="Previous page"
        onClick={onPrev}
      >
        <Icon size={20}>
          <path d="M14.5 5l-7 7 7 7" />
        </Icon>
      </button>
      <button
        type="button"
        className="rd-turn rd-turn-r"
        data-testid="reader-next"
        aria-label="Next page"
        onClick={onNext}
      >
        <Icon size={20}>
          <path d="M9.5 5l7 7-7 7" />
        </Icon>
      </button>
    </>
  );
}

type FooterProps = {
  page: string;
  chapter: string;
  ambient: string;
  pct: number;
};

/** The page and chapter readouts and the progress ribbon. */
export function Footer({ page, chapter, ambient, pct }: FooterProps) {
  return (
    <>
      <div className="rd-bottom" data-testid="reader-footer">
        <span className="rd-bottom-page" style={{ color: "var(--ink-2)" }}>
          {page}
        </span>
        <div
          style={{ flex: 1, textAlign: "center", letterSpacing: ".08em" }}
          data-testid="reader-chapter-counter"
        >
          {chapter}
        </div>
        {/* The phone footer moves the chapter to the right edge and swaps in the bare page while the chrome is hidden. */}
        <span className="rd-bottom-ch">{chapter}</span>
        <span className="rd-ambient-page">{ambient}</span>
      </div>
      <div className="rd-ribbon">
        <i style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}
