import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  type Book,
  type BookDetail as Detail,
  seriesQuery,
  thumbUrl,
} from "../../api";
import { Cover } from "../../components/Cover/Cover";
import { ChevronRightGlyph } from "../../components/Glyphs/Glyphs";
import { highlightsQuery, insightsQuery, reviewsQuery } from "./queries";
import { StarShape } from "./StarPicker";
import { finishTotals } from "./stats";

/** What the next book in the series says about itself: its place in the series it follows. */
const placeInSeries = (next: Book, series: string) =>
  next.series?.index
    ? `Book ${next.series.index} of ${series}`
    : `In ${series}`;

type FinishCardProps = {
  book: Detail;
  /** When the reader finished it, Unix seconds; `null` when the record has no time. */
  finishedAt: number | null;
  /** Rises into place; only for a book finished in this view. */
  entering: boolean;
  /** Takes the reader to their rating on the Reviews tab. */
  onLeaveReview: () => void;
};

/**
 * The card that takes the chapter bar's place once a book is finished: what it took, then one
 * whole-half target. Until you rate it that is "Leave a review"; once you have, the next book
 * in the series, or nothing when there is none.
 */
export function FinishCard({
  book,
  finishedAt,
  entering,
  onLeaveReview,
}: FinishCardProps) {
  const insights = useQuery(insightsQuery(book.uuid));
  const highlights = useQuery(highlightsQuery(book.uuid));
  const reviews = useQuery(reviewsQuery(book.uuid));
  const series = useQuery(seriesQuery(book.seriesId));

  const totals =
    insights.data && finishedAt !== null
      ? finishTotals({
          startedAt: insights.data.startedAt,
          finishedAt,
          sessions: insights.data.sessions,
          highlights: highlights.data?.length ?? 0,
        })
      : null;

  // Unknown is not unrated: nothing is offered until the reviews have answered.
  const rated = reviews.data ? reviews.data.mine?.stars != null : null;
  const books = series.data?.books ?? [];
  const at = books.findIndex((b) => b.uuid === book.uuid);
  const next = at >= 0 ? books[at + 1] : undefined;
  const seriesName = book.series?.name;

  let target = null;
  if (rated === false) {
    target = (
      <button type="button" className="bp-finish-next" onClick={onLeaveReview}>
        <span className="bp-finish-icon">
          <StarShape />
        </span>
        <span className="bp-finish-copy">
          <span className="bp-finish-title">Leave a review</span>
          <span className="bp-finish-meta">
            Tell your household what you thought
          </span>
        </span>
        <ChevronRightGlyph size={16} />
      </button>
    );
  } else if (rated && next && seriesName) {
    target = (
      <Link to={`/books/${next.uuid}`} className="bp-finish-next">
        <span className="bp-finish-cover" aria-hidden="true">
          <Cover
            book={next}
            src={next.hasCover ? thumbUrl(next.uuid, "sm") : null}
          />
        </span>
        <span className="bp-finish-copy">
          <span className="bp-finish-title">Up next: {next.title}</span>
          <span className="bp-finish-meta">
            {placeInSeries(next, seriesName)}
          </span>
        </span>
        <ChevronRightGlyph size={16} />
      </Link>
    );
  }

  return (
    <section
      className={entering ? "bp-finish is-entering" : "bp-finish"}
      aria-labelledby="bp-finish-heading"
    >
      <div>
        <h2 id="bp-finish-heading">You finished {book.title}</h2>
        {totals && <p className="bp-finish-stats">{totals}</p>}
      </div>
      {target}
    </section>
  );
}
