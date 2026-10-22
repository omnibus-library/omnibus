import { type KeyboardEvent, useRef, useState } from "react";
import { fillPercent } from "../../components/StarRating/stars";
import { prefersReducedMotion } from "../../motion";
import {
  halfAfterKey,
  halfStarLabel,
  previewNote,
  ratingAfterClick,
} from "./rating";

const SLOTS = [1, 2, 3, 4, 5] as const;
const HALVES = [
  { side: "left", className: "bd-star-half bd-star-half-left" },
  { side: "right", className: "bd-star-half bd-star-half-right" },
] as const;

/** The five-point star every control here draws, outlined or filled by its parent's CSS. */
export function StarShape() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 14.8 8.6l6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />
    </svg>
  );
}

type StarPickerProps = {
  stars: number | null;
  /** Called with the value tapped, or `null` when the tap was on the current value. */
  onPick: (stars: number | null) => void;
  /** The line beside the stars; while the pointer rests on a half star it reads that value instead. */
  note: string;
  /** The saved rating is not known, so a tap has nothing to compare with and rates nothing. */
  disabled?: boolean;
};

/**
 * Five stars, each with a button per half. The pointer previews the half or whole star under
 * it, a click rates once (or clears, on the current value), and the arrow keys step by halves.
 */
export function StarPicker({
  stars,
  onPick,
  note,
  disabled = false,
}: StarPickerProps) {
  const [hover, setHover] = useState<number | null>(null);
  // The slot just rated, with a count so the same slot can pop again.
  const [pop, setPop] = useState<{ slot: number; n: number } | null>(null);
  const group = useRef<HTMLDivElement>(null);
  // A hover preview wins over the saved value.
  const shown = hover ?? stars ?? 0;

  const commit = (next: number | null) => {
    // The fill should show the answer, not the pointer.
    setHover(null);
    if (next !== null && !prefersReducedMotion()) {
      setPop((last) => ({ slot: Math.ceil(next), n: (last?.n ?? 0) + 1 }));
    }
    onPick(next);
  };
  // A click on the saved value clears it; a key only ever rates.
  const pick = (value: number) => commit(ratingAfterClick(value, stars));

  // Arrows rate as they move, from the half that has focus: the saved value lags a keypress.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at =
      event.target instanceof HTMLElement ? event.target.dataset.value : null;
    const to = at ? halfAfterKey(Number(at), event.key) : null;
    if (to === null) return;
    event.preventDefault();
    group.current?.querySelector<HTMLElement>(`[data-value="${to}"]`)?.focus();
    commit(to);
  };

  return (
    <div className="bd-star-control">
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets */}
      <div
        ref={group}
        className="bd-stars bd-stars-interactive"
        role="group"
        aria-label="Your rating"
        data-testid="review-stars"
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        {SLOTS.map((slot) => (
          <span key={slot} className="bd-star-slot">
            <span
              key={pop?.slot === slot ? pop.n : 0}
              className={
                pop?.slot === slot ? "bd-star-art is-pop" : "bd-star-art"
              }
            >
              <span className="bd-star-bg">
                <StarShape />
              </span>
              <span
                className="bd-star-fg"
                style={{ width: `${fillPercent(shown, slot)}%` }}
              >
                <StarShape />
              </span>
            </span>
            {HALVES.map(({ side, className }) => {
              const value = side === "left" ? slot - 0.5 : slot;
              const label = halfStarLabel(value, stars);
              return (
                <button
                  key={side}
                  type="button"
                  className={className}
                  aria-label={label}
                  title={label}
                  data-value={value}
                  disabled={disabled}
                  // One tab stop: the rated half, else the first.
                  tabIndex={value === (stars ?? 0.5) ? 0 : -1}
                  onMouseEnter={() => setHover(value)}
                  onClick={() => pick(value)}
                />
              );
            })}
          </span>
        ))}
      </div>
      <div
        className="mono bd-review-starsmeta"
        role="status"
        aria-live={hover === null ? "polite" : "off"}
        data-testid="review-stars-meta"
      >
        {hover === null ? note : previewNote(hover, stars)}
      </div>
    </div>
  );
}
