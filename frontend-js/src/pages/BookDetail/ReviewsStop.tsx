import { useQuery } from "@tanstack/react-query";
import type { BookDetail, ReviewSummary } from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { StarRating } from "../../components/StarRating/StarRating";
import { fixed, plural } from "../../format";
import { OtherReviews } from "./OtherReviews";
import { reviewsQuery } from "./queries";
import { ReviewCard } from "./ReviewCard";
import { reviewsKicker, spreadBars, spreadLabel } from "./reviews";

/** The household's stars: the average, how many rated, and the spread over the ten half stars. */
function HouseholdSummary({ summary }: { summary: ReviewSummary }) {
  return (
    <section
      className="bd-review-summary"
      aria-label="Household rating"
      data-testid="review-summary"
    >
      <div className="bd-review-summary-figure">
        <span className="bd-review-summary-avg" data-testid="review-average">
          {fixed(summary.average, 1)}
        </span>
        <div className="bd-review-summary-side">
          <StarRating
            stars={summary.average}
            className="bd-review-summary-stars"
          />
          <span className="mono bd-review-summary-count">
            {summary.ratings} reader{plural(summary.ratings)} rated it
          </span>
        </div>
      </div>
      <div
        className="bd-review-spread"
        role="img"
        aria-label={spreadLabel(summary.buckets)}
        data-testid="review-spread"
      >
        {spreadBars(summary.buckets).map((bar) => (
          <div
            key={bar.label}
            className="bd-review-spread-col"
            title={bar.title}
          >
            <div className="bd-review-spread-track">
              {bar.readers > 0 ? (
                <div
                  className="bd-review-spread-bar"
                  data-testid="review-spread-bar"
                  style={{ height: `${bar.heightPct}%` }}
                >
                  <span className="mono bd-review-spread-value">
                    {bar.readers}
                  </span>
                </div>
              ) : (
                <div className="bd-review-spread-slot" />
              )}
            </div>
            <div className="mono bd-review-spread-label">{bar.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Stop 03: your review first, then the household's rating and every other reader's review. */
export function ReviewsStop({ book }: { book: BookDetail }) {
  const reviews = useQuery(reviewsQuery(book.uuid));
  const data = reviews.data;
  return (
    <div id="reviews" className="bdmq-reviews" data-testid="reviews-section">
      <div className="bdmq-k" data-testid="reviews-kicker">
        {data ? (
          reviewsKicker(data)
        ) : (
          <span className="ld-sheen">Counting reviews</span>
        )}
      </div>
      {data ? (
        <>
          <ReviewCard uuid={book.uuid} mine={data.mine} />
          {data.summary && <HouseholdSummary summary={data.summary} />}
          <OtherReviews uuid={book.uuid} others={data.others} />
        </>
      ) : reviews.isError ? (
        <p className="bdmq-quiet-body" role="alert">
          Couldn't load the reviews
          <button
            type="button"
            className="bdmq-synclink"
            onClick={() => reviews.refetch()}
          >
            Retry
          </button>
        </p>
      ) : (
        <Loading
          kind="section"
          className="start"
          label="Gathering the reviews"
        />
      )}
    </div>
  );
}
