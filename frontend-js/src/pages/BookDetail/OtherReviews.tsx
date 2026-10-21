import { useState } from "react";
import type { OtherReview } from "../../api";
import { Button } from "../../components/Button/Button";
import { StarRating } from "../../components/StarRating/StarRating";
import { fmtStars } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate } from "../../format";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { needsReadMore, splitOthers, spoilerVeiled } from "./reviews";

/** One reader's review with text: their stars stay in view, a spoiler's text behind a reveal. */
function OtherReviewCard({
  review,
  finished,
}: {
  review: OtherReview;
  finished: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { reader, stars, spoiler } = review;
  const md = review.bodyMd ?? "";
  const clipped = needsReadMore(md) && !expanded;
  return (
    <article className="bd-review-card" data-testid="review-card">
      <div className="bd-review-card-head">
        <UserAvatar
          user={reader}
          className="bd-review-avatar"
          photoClassName="bd-review-avatar-photo"
        />
        <div className="bd-review-byline">
          <span className="bd-review-name">{reader.name}</span>
          {stars !== null && (
            <StarRating stars={stars} className="bd-review-card-stars" />
          )}
          <span className="mono bd-review-date">
            {formatLongDate(review.updatedAt)}
          </span>
          {spoiler && (
            <span className="mono bd-review-spoilertag">spoilers</span>
          )}
        </div>
      </div>
      {spoilerVeiled(spoiler, finished, revealed) ? (
        <div className="bd-review-veil" data-testid="review-spoiler-veil">
          <span className="mono">This review gives away the story.</span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="review-spoiler-reveal"
            onClick={() => setRevealed(true)}
          >
            Show review
          </Button>
        </div>
      ) : (
        <>
          <RenderedMarkdown
            html={review.bodyHtml}
            md={md}
            className={clipped ? "bd-review-text is-clamped" : "bd-review-text"}
            testId="review-text"
          />
          {clipped && (
            <Button
              variant="ghost"
              size="sm"
              className="bd-review-more"
              data-testid="review-read-more"
              aria-expanded="false"
              onClick={() => setExpanded(true)}
            >
              Read more ↓
            </Button>
          )}
        </>
      )}
    </article>
  );
}

/** Every rating without text, as one row of avatars and stars. */
function StarsOnlyRow({ ratings }: { ratings: OtherReview[] }) {
  return (
    <div className="bd-review-starsrow" data-testid="review-stars-only">
      <span className="label bd-review-starsrow-k">Also rated</span>
      <ul
        className="bd-review-starsrow-list"
        aria-label="Ratings without a review"
      >
        {ratings.map(({ reader, stars }) => (
          <li
            key={reader.id}
            className="bd-review-starchip"
            data-testid="review-stars-only-item"
            title={
              stars === null
                ? reader.name
                : `${reader.name} · ${fmtStars(stars)} ★`
            }
          >
            <UserAvatar
              user={reader}
              className="bd-review-chip-avatar"
              photoClassName="bd-review-chip-avatar-photo"
            />
            <span className="sr-only">{reader.name}</span>
            {stars !== null && (
              <StarRating stars={stars} className="bd-review-chip-stars" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The other readers in the server's order: reviews with text as cards, then the bare ratings in one row. */
export function OtherReviews({
  others,
  finished,
}: {
  others: OtherReview[];
  finished: boolean;
}) {
  const { texts, ratings } = splitOthers(others);
  return (
    <>
      {texts.length === 0 && ratings.length === 0 && (
        <p className="mono bd-review-quiet" data-testid="other-reviews-empty">
          No one else has rated or reviewed this book yet.
        </p>
      )}
      {texts.length > 0 && (
        <div className="bd-review-list" data-testid="other-reviews">
          {texts.map((review) => (
            <OtherReviewCard
              key={review.reader.id}
              review={review}
              finished={finished}
            />
          ))}
        </div>
      )}
      {ratings.length > 0 && <StarsOnlyRow ratings={ratings} />}
    </>
  );
}
