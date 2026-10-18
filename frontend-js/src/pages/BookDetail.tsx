import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import {
  type BookUuid,
  coverUrl,
  type BookDetail as Detail,
  fetchBook,
  parseBookUuid,
} from "../api";
import { Cover, PageLoader } from "../atrium";
import { descriptionOverflows, homeKicker } from "../format";

function NotFound() {
  return <p className="library-empty">No book has that id.</p>;
}

type ChipRowProps = {
  label: string;
  listClass: string;
  chipClass: string;
  values: string[];
};

function ChipRow({ label, listClass, chipClass, values }: ChipRowProps) {
  if (values.length === 0) return null;
  return (
    <div className="bd-chip-row">
      <span className="label bd-chip-row-label">{label}</span>
      <ul className={listClass}>
        {values.map((value) => (
          <li key={value} className={chipClass}>
            {value}
          </li>
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
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the API runs descriptions through ammonia, which the Dioxus page relies on too
        dangerouslySetInnerHTML={{ __html: book.description }}
      />
      {descriptionOverflows(book.description) && (
        <button
          type="button"
          className="btn ghost sm bdmq-desc-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

function Marquee({ book }: { book: Detail }) {
  return (
    <div className="bdmq-stage" id="bdmq-stage">
      <div className="bdmq-coverwrap" aria-hidden="true">
        <div className="bdmq-coverpx" id="bdmq-coverpx">
          <Cover book={book} src={book.hasCover ? coverUrl(book.uuid) : null} />
        </div>
      </div>
      <div className="bdmq-flowscrim" aria-hidden="true" />
      <div className="bdmq-flowscroll" id="bdmq-flow">
        <div className="bdmq-flow">
          <section className="bdmq-flowsec lead">
            <div className="bdmq-flowbody">
              <div className="bdmq-k">{homeKicker(book)}</div>
              <div className="bdmq-titlerow">
                <h1 className="bdmq-title">{book.title}</h1>
              </div>
              {book.authors.length > 0 && (
                <p className="bdmq-by">
                  {"by "}
                  {book.authors.map((name, i) => (
                    <span key={name}>
                      {i > 0 && ", "}
                      <span className="bd-author-link">{name}</span>
                    </span>
                  ))}
                </p>
              )}
              <div className="bdmq-chips">
                <ChipRow
                  label="Genres"
                  listClass="bd-tag-list bd-genre-list"
                  chipClass="chip chip-genre"
                  values={book.genres}
                />
                <ChipRow
                  label="Tags"
                  listClass="bd-tag-list"
                  chipClass="chip"
                  values={book.subjects}
                />
              </div>
              <Description book={book} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function BookDetailFor({ uuid }: { uuid: BookUuid }) {
  const book = useQuery({
    queryKey: ["book", uuid],
    queryFn: () => fetchBook(uuid),
  });
  switch (book.status) {
    case "pending":
      return <PageLoader label="Taking it off the shelf" />;
    case "error":
      return (
        <p className="library-empty" role="alert">
          Couldn't load the book: {book.error.message}
        </p>
      );
    case "success":
      return book.data ? <Marquee book={book.data} /> : <NotFound />;
    default: {
      const _exhaustive: never = book;
      return _exhaustive;
    }
  }
}

export function BookDetail() {
  const uuid = parseBookUuid(useParams().uuid);
  return uuid ? <BookDetailFor uuid={uuid} /> : <NotFound />;
}
