import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CopyGlyph, DownloadGlyph } from "../Glyphs/Glyphs";
import "./QuoteCard.css";
import { QuoteBackground } from "./QuoteBackground";
import {
  cardSize,
  copyQuoteCardImage,
  exportQuoteCard,
  loadFaces,
  paintQuoteCard,
  shareQuoteCard,
} from "./quoteCanvas";
import { bookWash } from "./quoteColor";
import {
  collapse,
  FONTS,
  type FontKey,
  RATIOS,
  type Ratio,
  SIZES,
  type SizeKey,
} from "./quoteStyle";

type ChipsProps = { label: string; className: string; children: ReactNode };

// A pressed-button toggle group: the selection rides on `aria-pressed`.
function Chips({ label, className, children }: ChipsProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets
    <div className={className} role="group" aria-label={label}>
      {children}
    </div>
  );
}

type ChipProps = {
  on: boolean;
  onClick: () => void;
  style?: { fontFamily?: string; fontWeight?: number; fontStyle?: string };
  children: ReactNode;
};

function Chip({ on, onClick, style, children }: ChipProps) {
  return (
    <button
      type="button"
      className={on ? "rd-chip on" : "rd-chip"}
      style={style}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type QuoteCardProps = {
  text: string;
  author: string;
  /** The book's title, under the author. */
  subtitle: string;
  /** The book's `oklch(L C H)` accent; null falls back to the house tone. */
  accent: string | null;
  onClose: () => void;
};

/** The quote-card editor: a live canvas preview, its look controls, and download, copy and share. */
export function QuoteCard({
  text,
  author,
  subtitle,
  accent,
  onClose,
}: QuoteCardProps) {
  const [wash, setWash] = useState(() => bookWash(accent));
  const [ratio, setRatio] = useState<Ratio>("1:1");
  const [font, setFont] = useState<FontKey>("serif");
  const [size, setSize] = useState<SizeKey>("m");
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const drawing = useMemo(
    () => ({ text, author, subtitle, wash, ratio, font, size, bold, italic }),
    [text, author, subtitle, wash, ratio, font, size, bold, italic],
  );
  const preview = useRef<HTMLCanvasElement>(null);
  // The preview is the export's own painter, so the two cannot drift. It paints at once, then
  // again once the faces resolve; a newer state cancels the stale repaint.
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    let current = true;
    paintQuoteCard(canvas, drawing);
    loadFaces(drawing).then(() => {
      if (current) paintQuoteCard(canvas, drawing);
    });
    return () => {
      current = false;
    };
  }, [drawing]);
  return (
    <>
      <div className="rd-drawer-head">
        <div>
          <div className="rd-quote-kicker">From your highlight</div>
          <h4 className="rd-drawer-title">Make a quote card</h4>
        </div>
        <button
          type="button"
          className="rd-x"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="rd-drawer-body">
        <canvas
          ref={preview}
          className="rd-quote-card"
          data-testid="quote-preview"
          {...cardSize(ratio)}
        >
          <p data-testid="quote-preview-body">{collapse(text)}</p>
          <p>{author}</p>
          <p>{subtitle}</p>
        </canvas>
        <div className="rd-quote-controls">
          <QuoteBackground accent={accent} onChange={setWash} />
          <div className="rd-quote-label">Type</div>
          <div className="rd-quote-type">
            <Chips label="Font" className="rd-quote-chips">
              {FONTS.map((f) => (
                <Chip
                  key={f.key}
                  on={font === f.key}
                  style={{ fontFamily: f.css }}
                  onClick={() => setFont(f.key)}
                >
                  {f.label}
                </Chip>
              ))}
            </Chips>
            <Chips label="Text size" className="rd-quote-chips">
              {SIZES.map((s) => (
                <Chip
                  key={s.key}
                  on={size === s.key}
                  onClick={() => setSize(s.key)}
                >
                  {s.label}
                </Chip>
              ))}
            </Chips>
            <Chips label="Style" className="rd-quote-chips">
              <Chip
                on={bold}
                style={{ fontWeight: 700 }}
                onClick={() => setBold(!bold)}
              >
                Bold
              </Chip>
              <Chip
                on={italic}
                style={{ fontStyle: "italic" }}
                onClick={() => setItalic(!italic)}
              >
                Italic
              </Chip>
            </Chips>
          </div>
          <div className="rd-quote-label">Shape</div>
          <Chips label="Shape" className="rd-quote-chips">
            {RATIOS.map((r) => (
              <Chip
                key={r.key}
                on={ratio === r.key}
                onClick={() => setRatio(r.key)}
              >
                {r.name} {r.key}
              </Chip>
            ))}
          </Chips>
        </div>
      </div>
      <div className="rd-quote-actions">
        <button
          type="button"
          className="btn primary rd-desktop-only"
          data-testid="quote-download"
          onClick={() => exportQuoteCard(drawing)}
        >
          <DownloadGlyph />
          Download
        </button>
        <button
          type="button"
          className="btn"
          data-testid="quote-copy-image"
          onClick={() => copyQuoteCardImage(drawing)}
        >
          <CopyGlyph />
          Copy
        </button>
        {/* The phone's primary action; a browser that can't share files downloads. */}
        <button
          type="button"
          className="btn primary rd-phone-only"
          data-testid="quote-share"
          onClick={() => shareQuoteCard(drawing)}
        >
          Share
        </button>
      </div>
    </>
  );
}
