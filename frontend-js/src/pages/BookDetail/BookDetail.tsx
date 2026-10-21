import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import {
  type BookUuid,
  coverUrl,
  type BookDetail as Detail,
  parseBookUuid,
} from "../../api";
import { Cover } from "../../components/Cover/Cover";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { FilesStop } from "./FilesStop";
import { HighlightsStop } from "./HighlightsStop";
import { HomeStop } from "./HomeStop";
import { JournalStop } from "./JournalStop";
import { MoreStop } from "./MoreStop";
import { bookQuery } from "./queries";
import { ReviewsStop } from "./ReviewsStop";
import { StatsStop } from "./StatsStop";
import { useFlowScroll } from "./useFlowScroll";
import "./BookDetail.css";

// The Reviews stop's place in `sections`, where the title's household rating jumps to.
const REVIEWS_STOP = 2;

function Marquee({ book }: { book: Detail }) {
  const stage = useRef<HTMLDivElement>(null);
  const { active, backOn, goTo } = useFlowScroll(stage);
  // iOS pins the same order; a dot's number is its place here.
  const sections = [
    {
      name: "Home",
      stop: <HomeStop book={book} onShowReviews={() => goTo(REVIEWS_STOP)} />,
    },
    { name: "Stats", stop: <StatsStop book={book} /> },
    { name: "Reviews", stop: <ReviewsStop book={book} /> },
    { name: "Highlights", stop: <HighlightsStop book={book} /> },
    { name: "Journals", stop: <JournalStop book={book} /> },
    { name: "The files", stop: <FilesStop book={book} /> },
    { name: "More", stop: <MoreStop book={book} /> },
  ].map((section, i) => ({ ...section, no: String(i + 1).padStart(2, "0") }));
  return (
    <div
      className="bd-root bdmq"
      style={book.accent ? { "--accent": book.accent } : undefined}
    >
      <div className="bdmq-stage" id="bdmq-stage" ref={stage}>
        <PageTitle page={book.title} />
        <div className="bdmq-coverwrap" aria-hidden="true">
          <div className="bdmq-coverpx" id="bdmq-coverpx">
            <Cover
              book={book}
              src={book.hasCover ? coverUrl(book.uuid) : null}
            />
          </div>
        </div>
        <nav
          className="bdmq-dots"
          aria-label="Page sections"
          data-testid="bdmq-dots"
        >
          {sections.map(({ name, no }, i) => (
            <button
              key={name}
              type="button"
              className={i === active ? "bdmq-dotrow on" : "bdmq-dotrow"}
              title={name}
              data-testid={`bdmq-dot-${i}`}
              onClick={() => goTo(i)}
            >
              <i />
              <span className="lb">
                {no} · {name}
              </span>
            </button>
          ))}
        </nav>
        <div className="bdmq-flowscrim" aria-hidden="true" />
        <div className="bdmq-flowscroll" id="bdmq-flow">
          <div className="bdmq-flow">
            {sections.map(({ name, no, stop }, i) => (
              <section
                key={name}
                className={i === 0 ? "bdmq-flowsec lead" : "bdmq-flowsec"}
                data-testid={`bdmq-sec-${i}`}
              >
                {/* The first section is the book itself: its title is the heading. */}
                {i > 0 && (
                  <div className="bdmq-flowlab">
                    {no}
                    <b>{name}</b>
                    <i className="rule" aria-hidden="true" />
                  </div>
                )}
                <div className="bdmq-flowbody">{stop}</div>
              </section>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={backOn ? "bdmq-flowtop on" : "bdmq-flowtop"}
          id="bdmq-flowtop"
          data-testid="bdmq-flowtop"
          onClick={() => goTo(0)}
        >
          ↑ back to the book
        </button>
      </div>
    </div>
  );
}

function BookDetailFor({ uuid }: { uuid: BookUuid }) {
  const book = useQuery(bookQuery(uuid));
  const navigate = useNavigate();
  const client = useQueryClient();
  // A merged-away uuid resolves to the surviving book; its page keys are the survivor's.
  useEffect(() => {
    if (book.data && book.data.uuid !== uuid) {
      // Seeded so the survivor's page opens on this answer instead of a loader and a refetch.
      client.setQueryData(bookQuery(book.data.uuid).queryKey, book.data);
      navigate(`/books/${book.data.uuid}`, { replace: true });
    }
  }, [book.data, uuid, navigate, client]);
  switch (book.status) {
    case "pending":
      return <Loading kind="page" label="Taking it off the shelf" />;
    case "error":
      return (
        <PageError message={`Couldn't load the book: ${book.error.message}`} />
      );
    case "success":
      return book.data ? (
        <Marquee key={book.data.uuid} book={book.data} />
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
