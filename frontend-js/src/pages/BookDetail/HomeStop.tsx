import { skipToken, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link } from "react-router";
import { type BookDetail as Detail, fetchSeries } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { Chip } from "../../components/Chip/Chip";
import { ImmersiveGlyph } from "../../components/Glyphs/Glyphs";
import { descriptionOverflows, homeKicker } from "../../format";
import { FilePicker, isAudioFile, isReadableFile } from "./FilePicker";

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

function Kicker({ book }: { book: Detail }) {
  const { seriesId } = book;
  const series = useQuery({
    queryKey: ["series", seriesId],
    queryFn: seriesId === null ? skipToken : () => fetchSeries(seriesId),
  });
  const { series: name, tail } = homeKicker(
    book,
    series.data?.bookCount ?? null,
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

// The reader ladder is EPUB, then CBZ, then PDF, then audio.
function CtaRow({ book }: { book: Detail }) {
  const { uuid, hasEbook, hasAudio, hasComic, hasPdf } = book;
  const hasText = hasEbook || hasComic || hasPdf;
  const audioFiles = book.bookFiles.filter(isAudioFile);
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
          label="Start reading"
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
          Start reading
        </ButtonLink>
      ) : hasPdf ? (
        <ButtonLink
          variant="primary"
          size="lg"
          to={`/pdf/${uuid}`}
          data-testid="start-reading-pdf"
        >
          Start reading
        </ButtonLink>
      ) : (
        <FilePicker
          uuid={uuid}
          kind="listen"
          files={audioFiles}
          label="Start listening"
          buttonClass="btn primary lg"
          singleTestId="start-listening"
        />
      )}
      {hasAudio && hasText && (
        <FilePicker
          uuid={uuid}
          kind="listen"
          files={audioFiles}
          label="Listen"
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

/** Stop 01: the hero, with the kicker, title, authors, chips, description and the read and listen buttons. */
export function HomeStop({ book }: { book: Detail }) {
  return (
    <>
      <Kicker book={book} />
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
      <CtaRow book={book} />
    </>
  );
}
