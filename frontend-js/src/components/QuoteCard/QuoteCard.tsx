import { type ReactNode, useState } from "react";
import { CopyGlyph, DownloadGlyph } from "../Glyphs/Glyphs";
import "./QuoteCard.css";
import {
  copyQuoteCardImage,
  exportQuoteCard,
  shareQuoteCard,
} from "./quoteCanvas";
import {
  FONTS,
  type FontKey,
  fontCss,
  inkFor,
  LIGHT_INK,
  PRESETS,
  RATIOS,
  type Ratio,
  SIZES,
  type SizeKey,
  sizeCss,
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
  /** The card's starting background, the book's accent. */
  accent: string;
  onClose: () => void;
};

/** The quote-card editor: a live preview, its look controls, and download, copy and share. */
export function QuoteCard({
  text,
  author,
  subtitle,
  accent,
  onClose,
}: QuoteCardProps) {
  const [bg, setBg] = useState(accent);
  const [ink, setInk] = useState(LIGHT_INK);
  const [custom, setCustom] = useState("#6b4f8a");
  const [ratio, setRatio] = useState<Ratio>("1:1");
  const [font, setFont] = useState<FontKey>("serif");
  const [size, setSize] = useState<SizeKey>("m");
  const [bold, setBold] = useState(false);
  // The card's designed default is an italic serif pull-quote.
  const [italic, setItalic] = useState(true);
  const drawing = {
    text,
    author,
    subtitle,
    bg,
    ink,
    ratio,
    font,
    size,
    bold,
    italic,
  };
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
        <div
          className="rd-quote-card"
          data-testid="quote-preview"
          style={{
            aspectRatio: ratio.replace(":", "/"),
            background: bg,
            color: ink,
            fontFamily: fontCss(font),
          }}
        >
          <div className="rd-quote-card-head">OMNIBUS · QUOTE</div>
          <div
            className="rd-quote-card-body"
            data-testid="quote-preview-body"
            style={{
              fontSize: sizeCss(size),
              fontWeight: bold ? 700 : 400,
              fontStyle: italic ? "italic" : "normal",
            }}
          >
            “{text}”
          </div>
          <div className="rd-quote-card-foot">
            <div className="rd-quote-card-author">{author}</div>
            <div className="rd-quote-card-sub">{subtitle}</div>
          </div>
        </div>
        <div className="rd-quote-controls">
          <div className="rd-quote-label">Background</div>
          <div className="rd-quote-swatches">
            <button
              type="button"
              className="rd-quote-swatch"
              style={{ background: accent }}
              aria-label="Book accent"
              onClick={() => {
                setBg(accent);
                setInk(LIGHT_INK);
              }}
            />
            {PRESETS.map((preset) => (
              <button
                key={preset.bg}
                type="button"
                className="rd-quote-swatch"
                style={{ background: preset.bg }}
                aria-label={`Background ${preset.bg}`}
                onClick={() => {
                  setBg(preset.bg);
                  setInk(preset.ink);
                }}
              />
            ))}
            {/* A transparent input over a rainbow reads as a picker, not a preset. */}
            <label className="rd-quote-custom" title="Custom color">
              <input
                type="color"
                aria-label="Custom background color"
                value={custom}
                onChange={(event) => {
                  const hex = event.target.value;
                  setCustom(hex);
                  setInk(inkFor(hex));
                  setBg(hex);
                }}
              />
            </label>
          </div>
          <div className="rd-quote-label">Font</div>
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
          <div className="rd-quote-label">Size</div>
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
          <div className="rd-quote-label">Style</div>
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
          <div className="rd-quote-label">Aspect</div>
          <Chips label="Aspect ratio" className="rd-quote-ratios">
            {RATIOS.map((r) => (
              <Chip key={r} on={ratio === r} onClick={() => setRatio(r)}>
                {r}
              </Chip>
            ))}
          </Chips>
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
        </div>
      </div>
    </>
  );
}
