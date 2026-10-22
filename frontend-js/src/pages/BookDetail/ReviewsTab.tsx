import { useQuery } from "@tanstack/react-query";
import type { BookDetail } from "../../api";
import { Loading, Stale } from "../../components/Loading/Loading";
import { EmptyNote } from "./EmptyNote";
import { OtherReviews } from "./OtherReviews";
import { readStatusQuery, reviewsQuery } from "./queries";
import { ReviewCard } from "./ReviewCard";
import type { MyRating } from "./useMyRating";
import "./ReviewsTab.css";

/** Your review, then a card for every household reader who rated or reviewed the book. */
export function ReviewsTab({
  book,
  rating,
}: {
  book: BookDetail;
  rating: MyRating;
}) {
  const reviews = useQuery(reviewsQuery(book.uuid));
  // Unknown reads as not finished, so spoilers stay shut.
  const status = useQuery(readStatusQuery(book.uuid));
  const finished = status.data?.status === "finished";
  const data = reviews.data;
  if (!data) {
    return reviews.isError ? (
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
    );
  }
  const nobody = data.others.length === 0;
  return (
    <>
      <div
        className={nobody ? "bp-reviews is-solo" : "bp-reviews"}
        data-testid="reviews-section"
      >
        {nobody && (
          <EmptyNote heading="h2" title="No ratings or reviews yet">
            Nobody in your household has rated or reviewed this book.
          </EmptyNote>
        )}
        <div>
          <div className="bp-section-head">
            <h2>Your review</h2>
          </div>
          {/* The card is the labelled region, "Your review", itself. */}
          <ReviewCard uuid={book.uuid} mine={data.mine} rating={rating} />
        </div>
        {!nobody && (
          <section aria-labelledby="bp-household-reviews-title">
            <div className="bp-section-head">
              <h2 id="bp-household-reviews-title">
                Household <span className="bp-count">{data.others.length}</span>
              </h2>
            </div>
            {/* A write's follow-up read moves the others, so they dim while it runs. */}
            <Stale stale={reviews.isFetching}>
              <OtherReviews others={data.others} finished={finished} />
            </Stale>
          </section>
        )}
      </div>
      {reviews.isRefetchError && (
        <p
          className="bp-quiet"
          role="status"
          data-testid="reviews-refresh-failed"
        >
          Couldn’t refresh the other readers’ ratings — reopen the book to see
          them.
        </p>
      )}
    </>
  );
}
