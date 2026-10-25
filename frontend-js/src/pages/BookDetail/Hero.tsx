import { useQuery } from "@tanstack/react-query";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { type BookDetail as Detail, isWishlistOnly } from "../../api";
import { ChevronRightGlyph } from "../../components/Glyphs/Glyphs";
import { formatLongDate, plural, wishlistSource } from "../../format";
import { prefersReducedMotion } from "../../motion";
import type { BookDialog } from "./BookDialogs";
import { HeroActions } from "./HeroActions";
import { HeroCover } from "./HeroCover";
import { MiniStars } from "./MiniStars";
import { reviewsQuery, useWish } from "./queries";
import { heroRatingNote } from "./rating";
import { factLine } from "./readout";
import { StarPicker } from "./StarPicker";
import type { MyRating } from "./useMyRating";

/** The burst plays for two seconds; this is the moment it is taken down, a little after the last piece fades. */
const BURST_MS = 2300;

/** The authors, each linking to their page when the library has one, then the series, which jumps to its fan on the Overview. */
function Byline({
  book,
  onShowSeries,
}: {
  book: Detail;
  onShowSeries: () => void;
}) {
  const { series, seriesId } = book;
  const linked = !isWishlistOnly(book);
  if (book.creators.length === 0 && !series) return null;
  return (
    <p className="bp-byline" data-testid="book-authors">
      {book.creators.map(({ name, id }, i) => (
        <Fragment key={`${id}:${name}`}>
          {i > 0 && ", "}
          {id === null || !linked ? (
            <span>{name}</span>
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

/** Your stars, then the household's average and a count that opens the Reviews tab; the average waits for the server's summary. */
function Ratings({
  book,
  rating,
  onOpenReviews,
}: {
  book: Detail;
  rating: MyRating;
  onOpenReviews: () => void;
}) {
  const reviews = useQuery(reviewsQuery(book.uuid));
  const labelId = useId();
  const mine = reviews.data?.mine?.stars ?? null;
  // Until it is read, your own rating is not "none": the stars wait rather than offer a write over it.
  const read = reviews.data ? "ready" : reviews.isError ? "failed" : "loading";
  // The server sends a summary only once enough readers rated; its threshold is never recomputed here.
  const household = reviews.data?.summary ?? null;
  return (
    <div className="bp-ratings">
      <StarPicker
        stars={mine}
        onPick={rating.pick}
        disabled={read !== "ready"}
        note={heroRatingNote(rating.starsFailed, mine, read)}
      />
      {household && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the hero row never resets
        <div className="bp-rating-avg" role="group" aria-labelledby={labelId}>
          <span id={labelId} className="bp-rating-avg-label">
            Household average
          </span>
          <MiniStars stars={household.average} />
          <button
            type="button"
            className="bp-rating-avg-go"
            onClick={onOpenReviews}
          >
            {household.ratings} review{plural(household.ratings)}
            <ChevronRightGlyph size={16} />
          </button>
        </div>
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
  /** Selects the Reviews tab and brings it into view. */
  onOpenReviews: () => void;
  /** Opens one of the book's dialogs from the More menu. */
  onOpenDialog: (dialog: BookDialog) => void;
  /** Takes the reader to their rating on the Reviews tab. */
  onLeaveReview: () => void;
};

/** The hero: the cover on its stage, then the title, byline, facts, ratings, and the read and listen buttons with where the reader stands. */
export function Hero({
  book,
  rating,
  onShowSeries,
  onOpenReviews,
  onOpenDialog,
  onLeaveReview,
}: HeroProps) {
  const wish = useWish(book);
  // Finishing in this view is celebrated: a burst for two seconds, and the card rising into place.
  const [playing, setPlaying] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const stopBurst = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(stopBurst.current), []);
  const finish = () => {
    setCelebrating(true);
    if (prefersReducedMotion()) return;
    setPlaying(true);
    clearTimeout(stopBurst.current);
    stopBurst.current = setTimeout(() => setPlaying(false), BURST_MS);
  };
  // A book that is no longer finished (the save was refused, or the reader moved it back) has nothing to celebrate.
  const unfinish = useCallback(() => {
    clearTimeout(stopBurst.current);
    setCelebrating(false);
    setPlaying(false);
  }, []);
  const facts = factLine(book);
  return (
    <div className="bp-hero">
      <HeroCover book={book} playing={playing} />
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
        <Ratings book={book} rating={rating} onOpenReviews={onOpenReviews} />
        <HeroActions
          book={book}
          wish={wish}
          onOpenDialog={onOpenDialog}
          onFinish={finish}
          onUnfinish={unfinish}
          celebrating={celebrating}
          onLeaveReview={onLeaveReview}
        />
      </div>
    </div>
  );
}
