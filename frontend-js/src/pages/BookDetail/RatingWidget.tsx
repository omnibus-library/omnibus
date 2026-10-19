import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type BookUuid,
  clearRating,
  fetchOtherRatings,
  fetchRating,
  type OtherRating,
  saveRating,
} from "../../api";
import { StarRating } from "../../components/StarRating/StarRating";
import { fillPercent } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { ago, nowSecs } from "../../format";
import { shelvesQuery } from "./queries";
import { halfStarLabel, ratingAfterClick, ratingMeta } from "./rating";
import { useOptimisticSave } from "./useOptimisticSave";

const SLOTS = [1, 2, 3, 4, 5] as const;
const HALVES = [
  { side: "left", className: "bd-star-half bd-star-half-left" },
  { side: "right", className: "bd-star-half bd-star-half-right" },
] as const;
function OtherRatings({ ratings }: { ratings: OtherRating[] }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets
    <div
      className="bd-other-ratings"
      role="group"
      aria-label="Other ratings"
      data-testid="other-ratings"
    >
      {ratings.map(({ reader, stars, updatedAt }) => (
        <div
          key={reader.id}
          className="bd-other-rating-row"
          data-testid="other-rating-row"
        >
          <UserAvatar
            user={reader}
            className="bd-other-rating-avatar"
            photoClassName="bd-other-rating-avatar-photo"
          />
          <div
            className="bd-other-rating-content"
            data-testid="other-rating-content"
          >
            <div
              className="bd-other-rating-byline"
              data-testid="other-rating-byline"
            >
              <span className="bd-other-rating-name">{reader.name}</span> rated{" "}
              {ago(nowSecs(), updatedAt)}
            </div>
            <StarRating stars={stars} className="bd-other-rating-stars" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Your half-star rating, the line under it, and what other readers gave the book. */
export function RatingWidget({ uuid }: { uuid: BookUuid }) {
  const queryKey = ["book", uuid, "rating"];
  const otherKey = ["book", uuid, "otherRatings"];
  const rating = useQuery({ queryKey, queryFn: () => fetchRating(uuid) });
  const others = useQuery({
    queryKey: otherKey,
    queryFn: () => fetchOtherRatings(uuid),
  });
  const [hover, setHover] = useState<number | null>(null);
  const save = useOptimisticSave(
    queryKey,
    (stars: number | null) =>
      stars === null
        ? clearRating(uuid).then(() => null)
        : saveRating(uuid, stars),
    {
      optimistic: (stars) =>
        stars === null ? null : { stars, updatedAt: nowSecs() },
      // A smart shelf may now hold the book.
      alsoInvalidate: [otherKey, shelvesQuery(uuid).queryKey],
    },
  );
  const current = rating.data?.stars;
  const shown = hover ?? current ?? 0;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets */}
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
              const label = halfStarLabel(value, current);
              return (
                <button
                  key={side}
                  type="button"
                  className={className}
                  aria-label={label}
                  title={label}
                  onMouseEnter={() => setHover(value)}
                  onClick={() => save.mutate(ratingAfterClick(value, current))}
                />
              );
            })}
          </span>
        ))}
      </div>
      <div
        className="mono bd-rating-meta"
        role="status"
        data-testid="rating-meta"
      >
        {ratingMeta(save.isError, rating.data, nowSecs())}
      </div>
      {others.data && others.data.length > 0 && (
        <OtherRatings ratings={others.data} />
      )}
    </>
  );
}
