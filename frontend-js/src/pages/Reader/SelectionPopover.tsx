import type { ReactNode } from "react";
import type { HighlightColor } from "../../api";
import { HIGHLIGHT_COLORS } from "./annotations";
import { Scrim } from "./DrawerShell";

type SelectionPopoverProps = {
  /** The selection's bounding box in viewport coordinates. */
  rect: { x: number; y: number; width: number };
  onDismiss: () => void;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onQuote: () => void;
  onShare: () => void;
};

function Act({
  testId,
  className = "rd-act",
  onClick,
  fill,
  label,
  children,
}: {
  testId: string;
  className?: string;
  onClick: () => void;
  fill?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      onClick={onClick}
    >
      <svg
        width={15}
        height={15}
        viewBox="0 0 24 24"
        fill={fill ? "currentColor" : "none"}
        stroke={fill ? "none" : "currentColor"}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
      <span>{label}</span>
    </button>
  );
}

/** The floating swatches and actions over a text selection, anchored just above it and kept on screen. */
export function SelectionPopover({
  rect,
  onDismiss,
  onHighlight,
  onNote,
  onCopy,
  onQuote,
  onShare,
}: SelectionPopoverProps) {
  const top = Math.max(rect.y - 52, 8);
  const left = Math.min(Math.max(rect.x + rect.width / 2 - 150, 8), 560);
  return (
    <>
      {/* On phones the scrim is hidden so native selection handles reach the text; the glue's cleared report dismisses instead. */}
      <Scrim clear onClick={onDismiss} />
      <div className="rd-selection-popover" style={{ top, left }}>
        <div className="rd-swatch-row">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="rd-swatch"
              data-color={color}
              aria-label={`Highlight ${color}`}
              onClick={() => onHighlight(color)}
            />
          ))}
          <span className="rd-pop-div" />
          <Act testId="selection-note" onClick={onNote} label="Note">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </Act>
          <Act testId="selection-copy" onClick={onCopy} label="Copy">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </Act>
          {/* The phone popover tints Quote as the primary action. */}
          <Act
            testId="selection-quote"
            className="rd-act rd-act-accent"
            onClick={onQuote}
            fill
            label="Quote"
          >
            <path d="M10 8c0 3.5-2 6-5 7l-.8-1.6c1.7-.8 2.7-2 3-3.4H4V4h6v4zm10 0c0 3.5-2 6-5 7l-.8-1.6c1.7-.8 2.7-2 3-3.4H14V4h6v4z" />
          </Act>
          <Act testId="selection-share" onClick={onShare} label="Share">
            <path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
          </Act>
        </div>
      </div>
    </>
  );
}
