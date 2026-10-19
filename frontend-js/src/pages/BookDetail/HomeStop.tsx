import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link } from "react-router";
import {
  type BookDetail as Detail,
  type Progress,
  saveDescription,
  type WishlistEntry,
} from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { Chip } from "../../components/Chip/Chip";
import { FetchSummary } from "../../components/FetchSummary/FetchSummary";
import { ImmersiveGlyph } from "../../components/Glyphs/Glyphs";
import {
  descriptionOverflows,
  durationLabel,
  formatLongDate,
  homeKicker,
  summaryIsSparse,
} from "../../format";
import { FilePicker, isAudioFile, isReadableFile } from "./FilePicker";
import { WishlistCtas } from "./PhysicalCopies";
import { alignmentQuery, progressQuery, seriesQuery, useWish } from "./queries";
import { ReadStatus } from "./ReadStatus";
import { type HomeReadout, homeReadout, newestPercent } from "./readout";
import { SyncLine } from "./SyncLine";

type ChipRowProps = {
  label: string;
  listClass: string;
  tone: "plain" | "genre";
  values: string[];
};

function ChipRow({ label, listClass, tone, values }: ChipRowProps) {
  if (values.length === 0) return null;
  return (
    <div className="bd-chip-row">
      <span className="label bd-chip-row-label">{label}</span>
      <ul className={listClass}>
        {values.map((value) => (
          <Chip key={value} tone={tone}>
            {value}
          </Chip>
        ))}
      </ul>
    </div>
  );
}

function Description({ book }: { book: Detail }) {
  const [open, setOpen] = useState(false);
  if (!book.description) return null;
  const id = `bdmq-desc-${book.uuid}`;
  return (
    <>
      <div
        id={id}
        className={open ? "bdmq-desc bd-desc is-open" : "bdmq-desc bd-desc"}
        data-testid="book-description"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the API runs descriptions through ammonia, which the Dioxus page relies on too
        dangerouslySetInnerHTML={{ __html: book.description }}
      />
      {descriptionOverflows(book.description) && (
        <Button
          variant="ghost"
          size="sm"
          className="bdmq-desc-toggle"
          data-testid="book-description-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </>
  );
}

function Kicker({ book, wish }: { book: Detail; wish: WishlistEntry | null }) {
  const { seriesId } = book;
  const series = useQuery(seriesQuery(seriesId));
  const { series: name, tail } = homeKicker(
    book,
    series.data?.bookCount ?? null,
    wish,
  );
  return (
    <div className="bdmq-k">
      {name && seriesId !== null ? (
        <>
          <Link to={`/series/${seriesId}`} className="bdmq-k-link">
            {name}
          </Link>
          {tail}
        </>
      ) : (
        `${name ?? ""}${tail}`
      )}
    </div>
  );
}

function Authors({ book }: { book: Detail }) {
  if (book.creators.length === 0) return null;
  return (
    <p className="bdmq-by" data-testid="book-authors">
      {"by "}
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
    </p>
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
    </div>
  );
}

type RulerProps = {
  pct: number;
  readout: HomeReadout;
  lastOpened: string | null;
};

// Chapter ticks when the chapter table is known, a caret flag naming the chapter
// (or the bare percent), and the time left on the audio timeline at 1.0×.
function Ruler({ pct, readout, lastOpened }: RulerProps) {
  const { chTotal, chNow, audioAt, audioTotal, audioLeftSecs } = readout;
  const done = pct >= 100;
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
        {!done && audioLeftSecs !== null && audioLeftSecs > 0 && (
          <span>≈ {durationLabel(audioLeftSecs)} left at 1.0×</span>
        )}
      </div>
      {lastOpened && <div className="mono bdmq-lastopened">{lastOpened}</div>}
    </div>
  );
}

/** Stop 01: the hero, with the kicker, title, authors, chips, description, the read and listen buttons, and where the reader stands. */
export function HomeStop({ book }: { book: Detail }) {
  const client = useQueryClient();
  const wish = useWish(book);
  const hasFiles =
    book.hasEbook || book.hasAudio || book.hasComic || book.hasPdf;
  const progress = useQuery({ ...progressQuery(book.uuid), enabled: hasFiles });
  const alignment = useQuery({
    ...alignmentQuery(book.uuid),
    enabled: hasFiles,
  });
  const positions = progress.data ?? { reading: null, listening: null };
  const readout = homeReadout(alignment.data, positions.reading);
  const percent = newestPercent(positions);
  const dual = book.hasEbook && book.hasAudio;
  const updatedAt = Math.max(
    positions.reading?.updatedAt ?? 0,
    positions.listening?.updatedAt ?? 0,
  );
  return (
    <>
      <Kicker book={book} wish={wish} />
      <div className="bdmq-titlerow">
        <h1 className="bdmq-title">{book.title}</h1>
      </div>
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
      <Authors book={book} />
      <div className="bdmq-chips">
        <ChipRow
          label="Genres"
          listClass="bd-tag-list bd-genre-list"
          tone="genre"
          values={book.genres}
        />
        <ChipRow
          label="Tags"
          listClass="bd-tag-list"
          tone="plain"
          values={book.subjects}
        />
      </div>
      <Description book={book} />
      {summaryIsSparse(book.description ?? "") && (
        <FetchSummary
          uuid={book.uuid}
          onFetched={async (text) =>
            client.setQueryData(
              ["book", book.uuid],
              await saveDescription(book.uuid, text),
            )
          }
        />
      )}
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
          // A dual-format book has the sync line instead of a second recency line.
          lastOpened={
            dual || !updatedAt
              ? null
              : `last opened ${formatLongDate(updatedAt)}`
          }
        />
      )}
      {dual && <SyncLine uuid={book.uuid} />}
    </>
  );
}
