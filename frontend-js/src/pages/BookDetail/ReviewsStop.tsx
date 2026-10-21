import { useQuery } from "@tanstack/react-query";
import type { BookDetail, ReviewSummary } from "../../api";
import { Loading, Stale } from "../../components/Loading/Loading";
import { StarRating } from "../../components/StarRating/StarRating";
import { OtherReviews } from "./OtherReviews";
import { readStatusQuery, reviewsQuery } from "./queries";
import { ReviewCard } from "./ReviewCard";
import {
  averageLabel,
  countLabel,
  reviewsKicker,
  spreadBars,
  spreadSummary,
} from "./reviews";

/** The household's stars: the average, how many rated, and the spread over the ten half stars, drawn like the stats page's histogram. */
function ReviewSummaryBlock({ summary }: { summary: ReviewSummary }) {
  return (
    <div className="bd-review-summary" data-testid="review-summary">
      <div className="bd-review-avg">
        <span className="bd-review-avg-v" data-testid="review-summary-average">
          {averageLabel(summary.average)}
        </span>
        <div className="bd-review-avg-side">
          <StarRating stars={summary.average} className="bd-review-avg-stars" />
          <span
            className="mono bd-review-avg-n"
            data-testid="review-summary-count"
          >
            {countLabel(summary.ratings, "reader")} in the household
          </span>
        </div>
      </div>
      <div
        className="bd-review-spread"
        role="img"
        aria-label={spreadSummary(summary.buckets)}
        data-testid="review-spread"
      >
        {spreadBars(summary.buckets).map((bar) => (
          <div
            key={bar.halfStars}
            className="bd-review-spread-col"
            title={bar.title}
          >
            <div className="bd-review-spread-track">
              {bar.readers === 0 ? (
                <div className="bd-review-spread-slot" />
              ) : (
                <div
                  className="bd-review-spread-bar"
                  style={{ height: `${bar.heightPct}%` }}
                />
              )}
            </div>
            <div className="mono bd-review-spread-label">{bar.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stop 03: the counts kicker over your review, the household summary and every other reader's review. */
export function ReviewsStop({ book }: { book: BookDetail }) {
  const reviews = useQuery(reviewsQuery(book.uuid));
  // Unknown reads as not finished, so spoilers stay shut.
  const status = useQuery(readStatusQuery(book.uuid));
  const finished = status.data?.status === "finished";
  const data = reviews.data;
  return (
    <>
      <div className="bdmq-k" data-testid="reviews-kicker">
        {data ? (
          reviewsKicker(data)
        ) : (
          <span className="ld-sheen">Counting reviews</span>
        )}
      </div>
      <div id="reviews" className="bd-reviews" data-testid="reviews-section">
        {data ? (
          <>
            <ReviewCard uuid={book.uuid} mine={data.mine} />
            {/* A write's follow-up read moves the summary and the others, so they dim while it runs. */}
            <Stale stale={reviews.isFetching} className="bd-review-household">
              {data.summary && <ReviewSummaryBlock summary={data.summary} />}
              <OtherReviews others={data.others} finished={finished} />
            </Stale>
            {reviews.isRefetchError && (
              <p
                className="mono bd-review-stale-note"
                role="status"
                data-testid="reviews-refresh-failed"
              >
                Couldn’t refresh the other readers’ ratings — reopen the book to
                see them.
              </p>
            )}
          </>
        ) : reviews.isError ? (
          <div className="bd-journal-empty card" data-testid="reviews-error">
            <p className="mono">
              The reviews didn’t load — try reopening the book.
            </p>
          </div>
        ) : (
          <Loading
            kind="section"
            className="start"
            testId="reviews-loading"
            label="Gathering the reviews"
          />
        )}
      </div>
    </>
  );
}
