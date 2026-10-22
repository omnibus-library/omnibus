import { fillPercent, fmtStars } from "../../components/StarRating/stars";
import { StarShape } from "./StarPicker";

/** Another reader's stars at a glance, five small ones filled to the half. */
export function MiniStars({ stars }: { stars: number }) {
  return (
    <span
      className="bp-mini-stars"
      role="img"
      aria-label={`${fmtStars(stars)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((slot) => (
        <span key={slot} className="bp-mini" aria-hidden="true">
          <StarShape />
          <span
            className="bp-mini-fill"
            style={{ width: `${fillPercent(stars, slot)}%` }}
          >
            <StarShape />
          </span>
        </span>
      ))}
    </span>
  );
}
