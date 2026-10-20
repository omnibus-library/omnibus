import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { BookUuid, OtherReview } from "../../api";
import { Button } from "../../components/Button/Button";
import { StarRating } from "../../components/StarRating/StarRating";
import { fmtStars } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate } from "../../format";
import { readStatusQuery } from "./queries";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { splitOthers, startsCovered } from "./reviews";

/** A review's text clamped to a few lines, with Read more once it runs past them. */
function ClampedText({ review }: { review: OtherReview }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    // An image that loads later can push the text past the clamp.
    const watch = new ResizeObserver(measure);
    for (const child of el.children) watch.observe(child);
    return () => watch.disconnect();
  }, [open]);
  return (
    <>
      <div
        ref={box}
        id={id}
        className={
          open
            ? "bd-review-clamp"
            : overflows
              ? "bd-review-clamp clamped fades"
              : "bd-review-clamp clamped"
        }
      >
        <RenderedMarkdown
          html={review.bodyHtml}
          md={review.bodyMd ?? ""}
          className="bd-review-text"
          testId="review-text"
        />
      </div>
      {overflows && (
        <button
          type="button"
          className="bd-review-more"
          data-testid="review-read-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}

function WrittenReview({
  review,
  covered,
}: {
  review: OtherReview;
  covered: boolean;
}) {
  const [shown, setShown] = useState(false);
  const { reader, stars } = review;
  return (
    <article className="bd-review" data-testid="review">
      <div className="bd-review-head">
        <UserAvatar
          user={reader}
          className="bd-review-avatar"
          photoClassName="bd-review-avatar-photo"
        />
        <div className="bd-review-byline">
          <span className="bd-review-name">{reader.name}</span>
          {stars !== null && (
            <StarRating stars={stars} className="bd-review-stars" />
          )}
          <span className="mono bd-review-date">
            {formatLongDate(review.createdAt)}
          </span>
        </div>
      </div>
      {covered && !shown ? (
        <div className="bd-review-covered" data-testid="review-spoiler-cover">
          <span className="mono">Contains spoilers</span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="review-spoiler-reveal"
            onClick={() => setShown(true)}
          >
            Show review
          </Button>
        </div>
      ) : (
        <ClampedText review={review} />
      )}
    </article>
  );
}

/** Everyone who rated without writing, in one row: an avatar and their stars each. */
function RatedOnly({ ratings }: { ratings: OtherReview[] }) {
  return (
    <div className="bd-review-rated">
      <div className="label bd-review-rated-head">Also rated</div>
      <ul
        className="bd-review-rated-row"
        aria-label="Rated without a review"
        data-testid="review-rated-row"
      >
        {ratings.map(({ reader, stars }) => (
          <li
            key={reader.id}
            className="bd-review-rated-item"
            title={`${reader.name} · ${fmtStars(stars ?? 0)} ★`}
            data-testid="review-rated-item"
          >
            <UserAvatar
              user={reader}
              className="bd-review-rated-avatar"
              photoClassName="bd-review-rated-avatar-photo"
            />
            <span className="sr-only">{reader.name}</span>
            <StarRating stars={stars ?? 0} className="bd-review-rated-stars" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Other readers: their written reviews, spoilers folded unless you've finished, then the bare ratings. */
export function OtherReviews({
  uuid,
  others,
}: {
  uuid: BookUuid;
  others: OtherReview[];
}) {
  const status = useQuery(readStatusQuery(uuid));
  const { written, ratedOnly } = splitOthers(others);
  if (written.length === 0 && ratedOnly.length === 0) {
    return (
      <p className="mono bdmq-quiet-hint" data-testid="reviews-others-empty">
        No other reader has rated or reviewed it yet.
      </p>
    );
  }
  return (
    <div className="bd-review-others" data-testid="reviews-others">
      <div className="label bd-review-others-head">Other readers</div>
      {written.length > 0 && (
        <div className="bd-review-list">
          {written.map((review) => (
            <WrittenReview
              key={review.reader.id}
              review={review}
              covered={startsCovered(review, status.data?.status)}
            />
          ))}
        </div>
      )}
      {ratedOnly.length > 0 && <RatedOnly ratings={ratedOnly} />}
    </div>
  );
}
