import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link } from "react-router";
import type {
  BookDetail as Detail,
  Insights,
  Progress,
  UserId,
} from "../../api";
import { ButtonLink } from "../../components/Button/Button";
import { ImmersiveGlyph } from "../../components/Glyphs/Glyphs";
import { StarRating } from "../../components/StarRating/StarRating";
import { fmtStars } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { durationLabel, formatLongDate, wishlistSource } from "../../format";
import { useCurrentUser } from "../../session";
import { ExportMenu } from "./ExportMenu";
import { FilePicker, isAudioFile, isReadableFile } from "./FilePicker";
import { HeroCover } from "./HeroCover";
import { WishlistCtas } from "./PhysicalCopies";
import {
  alignmentQuery,
  insightsQuery,
  progressQuery,
  reviewsQuery,
  useWish,
} from "./queries";
import { ReadStatus } from "./ReadStatus";
import { heroRatingNote } from "./rating";
import {
  factLine,
  type HomeReadout,
  homeReadout,
  newestPercent,
} from "./readout";
import { StarPicker } from "./StarPicker";
import { SyncLine } from "./SyncLine";
import { pacedSecondsLeft } from "./stats";
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
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
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

const NO_FILES =
  "No ebook or audiobook files in your library yet — this title is tracked from your physical collection or wishlist.";

type CtaRowProps = { book: Detail; progress: Progress; readout: HomeReadout };

// The reader ladder is EPUB, then CBZ, then PDF, then audio.
function CtaRow({ book, progress, readout }: CtaRowProps) {
  const { uuid, hasEbook, hasAudio, hasComic, hasPdf } = book;
  const hasText = hasEbook || hasComic || hasPdf;
  const audioFiles = book.bookFiles.filter(isAudioFile);
  const { chNow, audioAt } = readout;
  const startedReading = (progress.reading?.percent ?? 0) > 0;
  const startedListening = (progress.listening?.audioSeconds ?? 0) > 0;
  const readVerb = !startedReading
    ? "Start reading"
    : chNow
      ? `Resume — Ch. ${chNow.n} · ${chNow.title}`
      : "Resume reading";
  const listenVerb = !startedListening
    ? "Start listening"
    : audioAt
      ? `Resume listening from ${audioAt}`
      : "Resume listening";
  const listenSecondary =
    startedListening && audioAt ? `Listen from ${audioAt}` : "Listen";
  if (!hasText && !hasAudio) {
    return (
      <div className="bdmq-ctarow">
        <p className="bd-no-files" data-testid="no-files-disclaimer">
          {NO_FILES}
        </p>
      </div>
    );
  }
  return (
    <div className="bdmq-ctarow">
      {hasEbook ? (
        <FilePicker
          uuid={uuid}
          kind="read"
          files={book.bookFiles.filter(isReadableFile)}
          label={readVerb}
          buttonClass="btn primary lg"
          singleTestId="start-reading"
        />
      ) : hasComic ? (
        <ButtonLink
          variant="primary"
          size="lg"
          to={`/comic/${uuid}`}
          data-testid="start-reading-comic"
        >
          {readVerb}
        </ButtonLink>
      ) : hasPdf ? (
        <ButtonLink
          variant="primary"
          size="lg"
          to={`/pdf/${uuid}`}
          data-testid="start-reading-pdf"
        >
          {readVerb}
        </ButtonLink>
      ) : (
        <FilePicker
          uuid={uuid}
          kind="listen"
          files={audioFiles}
          label={listenVerb}
          buttonClass="btn primary lg"
          singleTestId="start-listening"
        />
      )}
      {hasAudio && hasText && (
        <FilePicker
          uuid={uuid}
          kind="listen"
          files={audioFiles}
          label={listenSecondary}
          buttonClass="btn lg"
          singleTestId="listen-secondary"
        />
      )}
      {hasAudio && hasEbook && (
        <ButtonLink
          size="lg"
          className="bd-immersive-cta"
          to={`/read/${uuid}`}
          data-testid="immersive-read"
          title="Open the ereader and audiobook together, kept in sync"
        >
          <span className="bd-immersive-mark" aria-hidden="true">
            <ImmersiveGlyph />
          </span>
          Immersive
        </ButtonLink>
      )}
      {/* Every item sends or downloads a file; a comic-only or fileless record has none to offer. */}
      {(hasEbook || hasAudio || hasPdf) && <ExportMenu book={book} />}
    </div>
  );
}

type RulerProps = {
  pct: number;
  readout: HomeReadout;
  insights: Insights | null;
  lastOpened: string | null;
};

// Chapter ticks when the chapter table is known, a caret flag naming the chapter
// (or the bare percent), and the time left on the audio timeline at 1.0×.
function Ruler({ pct, readout, insights, lastOpened }: RulerProps) {
  const { chTotal, chNow, audioAt, audioTotal, audioLeftSecs } = readout;
  const done = pct >= 100;
  // The audio timeline at 1.0× when there is one, else the pace the reader has kept.
  const left =
    audioLeftSecs !== null && audioLeftSecs > 0
      ? `≈ ${durationLabel(audioLeftSecs)} left at 1.0×`
      : insights && pct > 0
        ? `≈ ${durationLabel(pacedSecondsLeft(insights, pct))} left at your pace`
        : null;
  const axis =
    chNow && chTotal
      ? `Ch. ${chNow.n} of ${chTotal} · ${pct}%`
      : audioAt && audioTotal
        ? `${audioAt} of ${audioTotal} · ${pct}%`
        : `${pct}% of the book`;
  return (
    <div className="bdmq-rulerwrap" data-testid="bdmq-ruler">
      <div className="rx-ruler">
        <div
          className={done ? "rx-fill done" : "rx-fill"}
          style={{ width: `${pct}%` }}
        />
        {chTotal !== null && (
          <div className="rx-tix" style={{ "--n": chTotal }} />
        )}
        {!done && (
          <div className="rx-caret" style={{ left: `${pct}%` }}>
            <i>{chNow ? `Ch. ${chNow.n}` : `${pct}%`}</i>
          </div>
        )}
      </div>
      <div className="rx-ruler-axis">
        <span>{axis}</span>
        {!done && left && <span>{left}</span>}
      </div>
      {lastOpened && <div className="mono bdmq-lastopened">{lastOpened}</div>}
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
};

/** The hero: the cover on its stage, then the title, byline, facts, ratings, and the read and listen buttons with where the reader stands. */
export function Hero({ book, rating, onShowSeries, onOpenReview }: HeroProps) {
  const wish = useWish(book);
  const hasFiles =
    book.hasEbook || book.hasAudio || book.hasComic || book.hasPdf;
  const progress = useQuery({ ...progressQuery(book.uuid), enabled: hasFiles });
  const alignment = useQuery({
    ...alignmentQuery(book.uuid),
    enabled: hasFiles,
  });
  const insights = useQuery({ ...insightsQuery(book.uuid), enabled: hasFiles });
  const positions = progress.data ?? { reading: null, listening: null };
  const readout = homeReadout(alignment.data, positions.reading);
  const percent = newestPercent(positions);
  const dual = book.hasEbook && book.hasAudio;
  const updatedAt = Math.max(
    positions.reading?.updatedAt ?? 0,
    positions.listening?.updatedAt ?? 0,
  );
  const facts = factLine(book);
  return (
    <div className="bp-hero">
      <HeroCover book={book} />
      <div className="bp-info">
        {wish && (
          <p className="bp-eyebrow">
            On your wishlist · added from {wishlistSource(wish.source)}
          </p>
        )}
        <h1 className="bp-title">{book.title}</h1>
        <ButtonLink
          variant="ghost"
          size="sm"
          className="bdmq-editcorner"
          to={`/books/${book.uuid}/edit`}
          data-testid="edit-metadata-hero"
          title="Edit metadata…"
          aria-label="Edit metadata"
        >
          ✎ Edit
        </ButtonLink>
        <Byline book={book} onShowSeries={onShowSeries} />
        {facts && <p className="bp-facts">{facts}</p>}
        <Ratings book={book} rating={rating} onOpenReview={onOpenReview} />
        {wish ? (
          <WishlistCtas book={book} />
        ) : (
          <CtaRow book={book} progress={positions} readout={readout} />
        )}
        <div className="bdmq-statusrow">
          <ReadStatus uuid={book.uuid} />
          {wish && (
            <span className="mono bdmq-statusnote">
              tracking since {formatLongDate(wish.addedAt)}
            </span>
          )}
        </div>
        {percent !== null && (
          <Ruler
            pct={Math.min(Math.max(percent, 0), 100)}
            readout={readout}
            insights={insights.data ?? null}
            // A dual-format book has the sync line instead of a second recency line.
            lastOpened={
              dual || !updatedAt
                ? null
                : `last opened ${formatLongDate(updatedAt)}`
            }
          />
        )}
        {dual && <SyncLine uuid={book.uuid} />}
      </div>
    </div>
  );
}
