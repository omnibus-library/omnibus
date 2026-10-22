import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link } from "react-router";
import type { BookDetail as Detail, UserId } from "../../api";
import { ChevronRightGlyph } from "../../components/Glyphs/Glyphs";
import { StarRating } from "../../components/StarRating/StarRating";
import { fmtStars } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate, wishlistSource } from "../../format";
import { useCurrentUser } from "../../session";
import type { BookDialog } from "./BookDialogs";
import { HeroActions } from "./HeroActions";
import { HeroCover } from "./HeroCover";
import { reviewsQuery, useWish } from "./queries";
import { heroRatingNote } from "./rating";
import { factLine } from "./readout";
import { StarPicker } from "./StarPicker";
import type { MyRating } from "./useMyRating";

/** The authors, each linking to their page when the library knows it, then the series, which jumps to its fan on the Overview. */
function Byline({
  book,
  onShowSeries,
}: {
  book: Detail;
  onShowSeries: () => void;
}) {
  const { series, seriesId } = book;
  if (book.creators.length === 0 && !series) return null;
  return (
    <p className="bp-byline" data-testid="book-authors">
      {book.creators.map(({ name, id }, i) => (
        <Fragment key={`${id}:${name}`}>
          {i > 0 && ", "}
          {id === null ? (
            <span className="bd-author-link">{name}</span>
          ) : (
            <Link to={`/authors/${id}`} className="bd-author-link">
              {name}
            </Link>
          )}
        </Fragment>
      ))}
      {series && (
        <>
          {book.creators.length > 0 && (
            <span className="bp-byline-sep" aria-hidden="true">
              {" · "}
            </span>
          )}
          {seriesId === null ? (
            <span className="bp-byline-series">{seriesLabel(series)}</span>
          ) : (
            <button
              type="button"
              className="bp-byline-series"
              onClick={onShowSeries}
            >
              {seriesLabel(series)}
            </button>
          )}
        </>
      )}
    </p>
  );
}

const seriesLabel = ({ name, index }: NonNullable<Detail["series"]>) =>
  index ? `${name}, book ${index}` : name;

/** Your stars beside each other reader's, and a row for you once you rate; absent while nobody has. */
function Ratings({
  book,
  rating,
  onOpenReview,
}: {
  book: Detail;
  rating: MyRating;
  onOpenReview: (reader: UserId) => void;
}) {
  const me = useCurrentUser();
  const reviews = useQuery(reviewsQuery(book.uuid));
  const mine = reviews.data?.mine?.stars ?? null;
  const others = (reviews.data?.others ?? []).filter(
    (review) => review.stars !== null,
  );
  return (
    <div className="bp-ratings">
      <StarPicker
        stars={mine}
        onPick={rating.pick}
        note={heroRatingNote(rating.starsFailed, mine)}
      />
      {(others.length > 0 || mine !== null) && (
        <ul className="bp-readers" aria-label="Household ratings">
          {others.map(({ reader, stars }) => (
            <li key={reader.id} className="bp-reader">
              <UserAvatar
                user={reader}
                className="bp-avatar"
                photoClassName="bp-avatar-photo"
              />
              <span className="bp-reader-name">{reader.name}</span>
              {stars !== null && (
                <>
                  <StarRating stars={stars} className="bp-mini-stars" />
                  <span className="bp-reader-score">{fmtStars(stars)}</span>
                </>
              )}
              <button
                type="button"
                className="bp-reader-go"
                aria-label={`See ${reader.name}'s review`}
                onClick={() => onOpenReview(reader.id)}
              >
                <ChevronRightGlyph size={16} />
              </button>
            </li>
          ))}
          {mine !== null && (
            <li className="bp-reader">
              <UserAvatar
                user={me}
                className="bp-avatar"
                photoClassName="bp-avatar-photo"
              />
              <span className="bp-reader-name">You</span>
              <StarRating stars={mine} className="bp-mini-stars" />
              <span className="bp-reader-score">{fmtStars(mine)}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

type HeroProps = {
  book: Detail;
  /** The page's one queue of writes to your review, shared with the Reviews tab. */
  rating: MyRating;
  /** Selects the Overview and brings the series fan into view. */
  onShowSeries: () => void;
  /** Opens that reader's review on the Reviews tab. */
  onOpenReview: (reader: UserId) => void;
  /** Opens one of the book's dialogs from the More menu. */
  onOpenDialog: (dialog: BookDialog) => void;
};

/** The hero: the cover on its stage, then the title, byline, facts, ratings, and the read and listen buttons with where the reader stands. */
export function Hero({
  book,
  rating,
  onShowSeries,
  onOpenReview,
  onOpenDialog,
}: HeroProps) {
  const wish = useWish(book);
  const facts = factLine(book);
  return (
    <div className="bp-hero">
      <HeroCover book={book} />
      <div className="bp-info">
        {wish && (
          <p className="label bp-eyebrow">
            On your wishlist · added from {wishlistSource(wish.source)}
          </p>
        )}
        <h1 className="bp-title">{book.title}</h1>
        <Byline book={book} onShowSeries={onShowSeries} />
        {facts && <p className="bp-facts">{facts}</p>}
        {wish && (
          <p className="bp-facts">
            Tracking since {formatLongDate(wish.addedAt)}
          </p>
        )}
        <Ratings book={book} rating={rating} onOpenReview={onOpenReview} />
        <HeroActions book={book} wish={wish} onOpenDialog={onOpenDialog} />
      </div>
    </div>
  );
}
