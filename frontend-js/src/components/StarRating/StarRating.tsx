import { classes } from "../../classes";
import "./StarRating.css";
import { fillPercent, fmtStars } from "./stars";

const SLOTS = [1, 2, 3, 4, 5] as const;

type StarRatingProps = { stars: number; className?: string };

/** Five stars filled to `stars`, read-only; a 4.5 shows four and a half. */
export function StarRating({ stars, className }: StarRatingProps) {
  return (
    <span
      role="img"
      className={classes("star-rating", className)}
      aria-label={`${fmtStars(stars)} out of 5 stars`}
    >
      {SLOTS.map((slot) => (
        <span key={slot} className="star-slot" aria-hidden="true">
          <span className="star-bg">★</span>
          <span
            className="star-fg"
            style={{ width: `${fillPercent(stars, slot)}%` }}
          >
            ★
          </span>
        </span>
      ))}
    </span>
  );
}
