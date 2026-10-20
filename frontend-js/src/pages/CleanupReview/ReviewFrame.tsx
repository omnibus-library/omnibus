import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router";
import {
  CLEANUP_KINDS,
  type CleanupKind,
  type CleanupKindCounts,
  cleanupKindLabel,
} from "../../api";
import { classes } from "../../classes";
import { dotState, kindTitle } from "./review";
import "../BookEdit/BookEdit.css";
import "./CleanupReview.css";

/** Administration › Cleanup › Review <kind>. */
function Crumb({ kind }: { kind: CleanupKind | null }) {
  return (
    <nav className="bd-crumb crx-crumb" aria-label="breadcrumb">
      <Link to="/admin" className="bd-crumb-home">
        Administration
      </Link>
      <span className="bd-crumb-sep" aria-hidden="true">
        ›
      </span>
      <Link to="/admin?section=cleanup" className="bd-crumb-step">
        Cleanup
      </Link>
      <span className="bd-crumb-sep" aria-hidden="true">
        ›
      </span>
      <span className="bd-crumb-curr" aria-current="page">
        {kindTitle(kind)}
      </span>
    </nav>
  );
}

/** "3 of 9" and one dot per card of the pass. */
function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="crx-progress" data-testid="cleanup-progress">
      <span className="crx-progress-text">
        {Math.min(index + 1, total)} of {total}
      </span>
      <div className="crx-dots">
        {Array.from({ length: total }, (_, slot) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a dot is its position
            key={slot}
            className={classes("crx-dot", dotState(slot, index))}
          />
        ))}
      </div>
    </div>
  );
}

/** One chip per kind, linking to its queue, with its pending count once the counts arrive. */
function KindLine({
  current,
  counts,
}: {
  current: CleanupKind | null;
  counts: CleanupKindCounts[] | undefined;
}) {
  return (
    <div className="crx-kindline" data-testid="cleanup-kindline">
      {CLEANUP_KINDS.map((kind) => {
        const pending = counts?.find((row) => row.kind === kind)?.counts
          .pending;
        return (
          <Link
            key={kind}
            to={`/admin/cleanup/${kind}`}
            className={kind === current ? "crx-kindchip on" : "crx-kindchip"}
            aria-current={kind === current ? "page" : "false"}
            data-testid={`cleanup-kindchip-${kind}`}
          >
            {cleanupKindLabel(kind)}
            {pending !== undefined && (
              <span className="crx-kind-count">{pending}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** The crumb, the heading with its progress, and the kind line around a review; the column takes focus on mount. */
export function ReviewFrame({
  kind,
  counts,
  progress,
  children,
}: {
  kind: CleanupKind | null;
  counts: CleanupKindCounts[] | undefined;
  progress: { index: number; total: number } | null;
  children: ReactNode;
}) {
  const column = useRef<HTMLDivElement>(null);
  useEffect(() => {
    column.current?.focus();
  }, []);
  return (
    <div className="crx-root">
      <Crumb kind={kind} />
      <div className="crx-stage">
        <div
          ref={column}
          className="crx-column cleanup-review"
          data-testid="cleanup-review"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus lands here on mount, so the review keys work at once
          tabIndex={0}
        >
          <div className="crx-head">
            <h1 className="crx-head-title">{kindTitle(kind)}</h1>
            {progress && <Progress {...progress} />}
          </div>
          <KindLine current={kind} counts={counts} />
          {children}
        </div>
      </div>
    </div>
  );
}

/** A reader's refusal: the heading and one line, with none of the admin chrome. */
export function ReviewRefusal({ kind }: { kind: CleanupKind | null }) {
  return (
    <div className="crx-root">
      <div className="crx-stage">
        <div className="crx-column">
          <div className="crx-head">
            <h1 className="crx-head-title">{kindTitle(kind)}</h1>
          </div>
          <p
            className="settings-status error"
            data-testid="cleanup-review-forbidden"
          >
            Administrator access is required to review library cleanup.
          </p>
        </div>
      </div>
    </div>
  );
}
