import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { useParams } from "react-router";
import {
  type BookUuid,
  coverUrl,
  type BookDetail as Detail,
  fetchBook,
  parseBookUuid,
} from "../../api";
import { Cover } from "../../components/Cover/Cover";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { FilesStop } from "./FilesStop";
import { HomeStop } from "./HomeStop";
import { useFlowScroll } from "./useFlowScroll";
import "./BookDetail.css";

// iOS pins the same order; a dot's number is its place here.
export const MARQUEE_SECTIONS = [
  "Home",
  "Stats",
  "Highlights",
  "Journals",
  "The files",
  "More",
] as const;

function Marquee({ book }: { book: Detail }) {
  const stage = useRef<HTMLDivElement>(null);
  const { active, backOn, goTo } = useFlowScroll(stage);
  const stops: Partial<Record<(typeof MARQUEE_SECTIONS)[number], ReactNode>> = {
    Home: <HomeStop book={book} />,
    "The files": <FilesStop book={book} />,
  };
  const sections = MARQUEE_SECTIONS.flatMap((name, i) => {
    const stop = stops[name];
    return stop ? [{ name, no: String(i + 1).padStart(2, "0"), stop }] : [];
  });
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
