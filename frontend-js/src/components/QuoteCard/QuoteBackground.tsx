import { useState } from "react";
import {
  bookWash,
  customSolidWash,
  SOLIDS,
  solidWash,
  type Wash,
} from "./quoteColor";

const CUSTOM_START = "#6b4f8a";

type QuoteBackgroundProps = {
  /** The book's `oklch(L C H)` accent; null falls back to the house tone. */
  accent: string | null;
  onChange: (wash: Wash) => void;
};

/** The quote card's Background section: its heading and the row of swatches. */
export function QuoteBackground({ accent, onChange }: QuoteBackgroundProps) {
  const [picked, setPicked] = useState("book");
  const [custom, setCustom] = useState(CUSTOM_START);
  const choose = (id: string, wash: Wash) => {
    setPicked(id);
    onChange(wash);
  };
  const ring = (id: string) => (picked === id ? " on" : "");
  return (
    <>
      <div className="rd-quote-label">Background</div>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets */}
      <div
        className="rd-quote-swatches"
        role="group"
        aria-label="Solid backgrounds"
      >
        <button
          type="button"
          className={`rd-quote-swatch solid${ring("book")}`}
          style={{ background: bookWash(accent).from }}
          aria-label="Book"
          aria-pressed={picked === "book"}
          onClick={() => choose("book", bookWash(accent))}
        />
        {SOLIDS.map((solid) => (
          <button
            key={solid.id}
            type="button"
            className={`rd-quote-swatch solid${ring(solid.id)}`}
            style={{ background: solidWash(solid.base, solid.light).from }}
            aria-label={solid.name}
            aria-pressed={picked === solid.id}
            onClick={() => choose(solid.id, solidWash(solid.base, solid.light))}
          />
        ))}
        {/* A transparent input over a rainbow reads as a picker, not a preset. */}
        <label
          className={`rd-quote-custom solid${ring("custom")}`}
          title="Custom color"
        >
          <input
            type="color"
            aria-label="Custom background color"
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              choose("custom", customSolidWash(event.target.value));
            }}
          />
          <span aria-hidden="true">+</span>
        </label>
      </div>
    </>
  );
}
