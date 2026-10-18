import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import {
  type BookUuid,
  coverUrl,
  type BookDetail as Detail,
  fetchBook,
  parseBookUuid,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Chip } from "../../components/Chip/Chip";
import { Cover } from "../../components/Cover/Cover";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { descriptionOverflows, homeKicker } from "../../format";
import "./BookDetail.css";

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
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the API runs descriptions through ammonia, which the Dioxus page relies on too
        dangerouslySetInnerHTML={{ __html: book.description }}
      />
      {descriptionOverflows(book.description) && (
        <Button
          variant="ghost"
          size="sm"
          className="bdmq-desc-toggle"
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

function Marquee({ book }: { book: Detail }) {
  return (
    <div className="bdmq-stage" id="bdmq-stage">
      <PageTitle page={book.title} />
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
      return <Loading kind="page" label="Taking it off the shelf" />;
    case "error":
      return (
        <PageError message={`Couldn't load the book: ${book.error.message}`} />
      );
    case "success":
      return book.data ? (
        <Marquee book={book.data} />
      ) : (
        <PageNotFound subject="Book" />
      );
    default: {
      const _exhaustive: never = book;
      return _exhaustive;
    }
  }
}

export function BookDetail() {
  const uuid = parseBookUuid(useParams().uuid);
  return uuid ? <BookDetailFor uuid={uuid} /> : <PageNotFound subject="Book" />;
}
