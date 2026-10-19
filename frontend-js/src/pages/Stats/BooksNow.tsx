import { Link } from "react-router";
import type { ResumePoint, StatsSummary } from "../../api";
import { CoverImage } from "../../components/Cover/CoverImage";
import { StarRating } from "../../components/StarRating/StarRating";
import { type FinishedBook, FinishedCover } from "./FinishedCover";
import {
  clampedStars,
  IN_PROGRESS_SHOWN,
  moreOpenNote,
  resumePercent,
  resumeReadout,
  yearProjection,
} from "./readingNow";

/** One open book: cover, title and author, a progress bar and the readout. */
function OpenRow({ point }: { point: ResumePoint }) {
  const readout = resumeReadout(point);
  const author = point.book.authors[0];
  return (
    <Link className="st-open-row" to={`/books/${point.book.uuid}`}>
      <div className="st-open-cover">
        <div className="shelf-cover-tile">
          <CoverImage book={point.book} sizes="44px" />
        </div>
      </div>
      <div className="st-open-body">
        <div className="st-open-title">{point.book.title}</div>
        {author !== undefined && <div className="st-open-author">{author}</div>}
        <div className="st-open-track">
          <div
            className="st-open-fill"
            style={{ width: `${resumePercent(point)}%` }}
          />
        </div>
      </div>
      {readout !== null && <div className="st-open-readout">{readout}</div>}
    </Link>
  );
}

/** "In progress": the books currently open, with the year's projected finish beneath them. */
export function InProgressCard({
  books,
  summary,
}: {
  books: ResumePoint[];
  summary: StatsSummary;
}) {
  const projection = yearProjection(summary);
  const more = moreOpenNote(books.length);
  return (
    <div className="card st-open" data-testid="stats-in-progress">
      <div className="label">In progress</div>
      {books.length === 0 ? (
        <p className="st-card-empty">Nothing open right now.</p>
      ) : (
        <div className="st-open-list">
          {books.slice(0, IN_PROGRESS_SHOWN).map((point) => (
            <OpenRow key={point.key} point={point} />
          ))}
        </div>
      )}
      {more !== null && (
        <p className="st-open-more" data-testid="stats-in-progress-more">
          {more}
        </p>
      )}
      {projection !== null && (
        <div className="st-open-foot" data-testid="stats-year-projection">
          <span className="st-open-foot-label">
            At this pace you finish the year on
          </span>
          <span className="st-open-foot-value">{projection} books</span>
        </div>
      )}
    </div>
  );
}

/** One finished book: cover, title and author, and its rating in stars. */
function FinishedRow({ book }: { book: FinishedBook }) {
  const stars = clampedStars(book.rating);
  return (
    <Link className="st-finished-row" to={`/books/${book.book_uuid}`}>
      <div className="st-finished-cover">
        <FinishedCover book={book} sizes="34px" />
      </div>
      <div className="st-finished-body">
        <div className="st-finished-title">{book.title}</div>
        {book.author && <div className="st-finished-author">{book.author}</div>}
      </div>
      {stars === null ? (
        <div className="st-finished-stars st-finished-unrated">—</div>
      ) : (
        <StarRating stars={stars} className="st-finished-stars" />
      )}
    </Link>
  );
}

/** "Recently finished": the latest completions with the rating each carries, whatever window is showing, so it can't contradict the Finished tile above. */
export function RecentlyFinishedCard({ books }: { books: FinishedBook[] }) {
  return (
    <div className="card st-finished" data-testid="stats-recently-finished">
      <div className="label">Recently finished</div>
      {books.length === 0 ? (
        <p className="st-card-empty">Nothing finished yet.</p>
      ) : (
        <div className="st-finished-list">
          {books.slice(0, 4).map((book) => (
            <FinishedRow key={book.book_uuid} book={book} />
          ))}
        </div>
      )}
    </div>
  );
}
