import { useState } from "react";
import type { OtherReview } from "../../api";
import { fmtStars } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate } from "../../format";
import { MiniStars } from "./MiniStars";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { needsReadMore, spoilerVeiled } from "./reviews";

/** One household reader: who, when, their stars and then their text, a spoiler's behind a reveal; "Rated only" when they wrote nothing. */
function HouseholdCard({
  review,
  finished,
}: {
  review: OtherReview;
  finished: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { reader, stars, spoiler } = review;
  const md = review.bodyMd;
  const clipped = md !== null && needsReadMore(md) && !expanded;
  return (
    <article
      aria-label={`${reader.name}'s review`}
      className="bp-panel bp-entry bp-review-card"
      data-testid="review-card"
    >
      <UserAvatar
        user={reader}
        className="bp-avatar"
        photoClassName="bp-avatar-photo"
      />
      <div>
        <p className="bp-entry-meta">
          <strong>{reader.name}</strong> · {formatLongDate(review.updatedAt)}
          {spoiler && <span className="bp-spoiler-tag"> · spoilers</span>}
        </p>
        {stars !== null && (
          <p className="bp-review-score">
            <MiniStars stars={stars} />
            {fmtStars(stars)}
          </p>
        )}
        {md === null ? (
          <p className="bp-entry-text bp-rated-only">Rated only</p>
        ) : spoilerVeiled(spoiler, finished, revealed) ? (
          <div className="bp-review-veil" data-testid="review-spoiler-veil">
            <span>This review gives away the story.</span>
            <button
              type="button"
              className="bp-link-row"
              data-testid="review-spoiler-reveal"
              onClick={() => setRevealed(true)}
            >
              Show review
            </button>
          </div>
        ) : (
          <>
            <RenderedMarkdown
              html={review.bodyHtml}
              md={md}
              className={
                clipped
                  ? "bp-entry-text bd-review-text is-clamped"
                  : "bp-entry-text bd-review-text"
              }
              testId="review-text"
            />
            {clipped && (
              <button
                type="button"
                className="bp-link-row"
                data-testid="review-read-more"
                onClick={() => setExpanded(true)}
              >
                Read more
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** A card for every other reader who rated or reviewed, in the server's order. */
export function OtherReviews({
  others,
  finished,
}: {
  others: OtherReview[];
  finished: boolean;
}) {
  return (
    <ul className="bp-review-list" data-testid="other-reviews">
      {others.map((review) => (
        <li key={review.reader.id}>
          <HouseholdCard review={review} finished={finished} />
        </li>
      ))}
    </ul>
  );
}
