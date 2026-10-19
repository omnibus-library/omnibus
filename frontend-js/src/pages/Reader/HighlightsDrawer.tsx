import { useState } from "react";
import type { Highlight, HighlightColor } from "../../api";
import { classes } from "../../classes";
import { type AnnotationBridge, HIGHLIGHT_COLORS } from "./annotations";
import { DrawerShell } from "./DrawerShell";

type HighlightsDrawerProps = {
  highlights: Highlight[];
  /** The viewer the rows jump into; epub.js or PDF.js. */
  bridge: AnnotationBridge;
  onRecolor: (highlight: Highlight, color: HighlightColor) => void;
  onDelete: (highlight: Highlight) => void;
  onQuote: (highlight: Highlight) => void;
  onEditNote: (highlight: Highlight) => void;
  onClose: () => void;
};

type RowProps = Omit<HighlightsDrawerProps, "highlights" | "onClose"> & {
  highlight: Highlight;
  onJump: (anchor: string) => void;
};

function Row({
  highlight,
  bridge,
  onRecolor,
  onDelete,
  onQuote,
  onEditNote,
  onJump,
}: RowProps) {
  const { anchor, color, note, text } = highlight;
  return (
    <div
      className="rd-hl-row"
      data-testid="reader-highlight-row"
      style={{ borderLeftColor: `var(--hl-${color})` }}
    >
      <button
        type="button"
        className="rd-hl-quote"
        // A row with no anchor, such as a Kobo's, has nowhere to jump; the quote still shows.
        disabled={anchor === null}
        onClick={() => anchor !== null && onJump(anchor)}
      >
        {`“${text ?? "(highlighted passage)"}”`}
      </button>
      {note !== null && <div className="rd-hl-note">{note}</div>}
      <div className="rd-hl-swatches" data-testid="reader-highlight-swatches">
        {HIGHLIGHT_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={classes("rd-hl-swatch", swatch === color && "on")}
            data-color={swatch}
            data-testid={`reader-highlight-recolor-${swatch}`}
            aria-label={`Recolor ${swatch}`}
            aria-pressed={swatch === color}
            onClick={() => onRecolor(highlight, swatch)}
          />
        ))}
      </div>
      <div className="rd-hl-actions">
        <button
          type="button"
          className="rd-act sm"
          data-testid="highlight-note"
          onClick={() => onEditNote(highlight)}
        >
          {note === null ? "Add note" : "Edit note"}
        </button>
        <button
          type="button"
          className="rd-act sm"
          data-testid="highlight-quote"
          onClick={() => onQuote(highlight)}
        >
          Quote
        </button>
        {/* A highlight made before the text column was added has nothing to copy. */}
        <button
          type="button"
          className="rd-act sm"
          disabled={text === null}
          onClick={() => text !== null && bridge.copy(text)}
        >
          Copy
        </button>
        <button
          type="button"
          className="rd-act sm"
          data-testid="highlight-delete"
          onClick={() => onDelete(highlight)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** The highlights and notes drawer: every passage in the book, filterable by color, with its row actions. */
export function HighlightsDrawer({
  highlights,
  onClose,
  ...row
}: HighlightsDrawerProps) {
  const [filter, setFilter] = useState<HighlightColor | null>(null);
  const shown = highlights.filter((h) => filter === null || h.color === filter);
  return (
    <DrawerShell
      testId="reader-highlights-drawer"
      onClose={onClose}
      head={
        <h4 className="rd-drawer-title">
          Highlights &amp; notes{" "}
          <span className="rd-drawer-count">{highlights.length}</span>
        </h4>
      }
    >
      <div className="rd-filter-row">
        <button
          type="button"
          className={classes("rd-chip", filter === null && "on")}
          aria-pressed={filter === null}
          onClick={() => setFilter(null)}
        >
          All {highlights.length}
        </button>
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={classes("rd-chip", filter === color && "on")}
            aria-label={`Filter ${color}`}
            aria-pressed={filter === color}
            onClick={() => setFilter(color)}
          >
            <span className="rd-chip-dot" data-color={color} />
          </button>
        ))}
      </div>
      <div className="rd-drawer-body">
        {shown.length === 0 ? (
          <div className="rd-drawer-empty">No highlights yet.</div>
        ) : (
          shown.map((highlight) => (
            <Row
              key={highlight.id}
              highlight={highlight}
              onJump={(anchor) => {
                row.bridge.navigate(anchor);
                onClose();
              }}
              {...row}
            />
          ))
        )}
      </div>
    </DrawerShell>
  );
}
