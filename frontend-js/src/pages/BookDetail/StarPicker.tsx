import { useState } from "react";
import { fillPercent } from "../../components/StarRating/stars";
import { halfStarLabel, ratingAfterClick } from "./rating";

const SLOTS = [1, 2, 3, 4, 5] as const;
const HALVES = [
  { side: "left", className: "bd-star-half bd-star-half-left" },
  { side: "right", className: "bd-star-half bd-star-half-right" },
] as const;

type StarPickerProps = {
  stars: number | null;
  /** Called with the value tapped, or `null` when the tap was on the current value. */
  onPick: (stars: number | null) => void;
};

/** Five stars, each with a button per half: one tap rates, a tap on the current value clears. */
export function StarPicker({ stars, onPick }: StarPickerProps) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? stars ?? 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets
    <div
      className="bd-stars bd-stars-interactive"
      role="group"
      aria-label="Your rating"
      data-testid="rating-stars"
      onMouseLeave={() => setHover(null)}
    >
      {SLOTS.map((slot) => (
        <span key={slot} className="bd-star-slot">
          <span className="bd-star-bg">★</span>
          <span
            className="bd-star-fg"
            style={{ width: `${fillPercent(shown, slot)}%` }}
          >
            ★
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
                onMouseEnter={() => setHover(value)}
                onClick={() => onPick(ratingAfterClick(value, stars))}
              />
            );
          })}
        </span>
      ))}
    </div>
  );
}
