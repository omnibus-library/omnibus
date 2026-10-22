import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  type BookUuid,
  coverUrl,
  type BookDetail as Detail,
  parseBookUuid,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider } from "../../components/Toast/Toast";
import { BookTabs, useBookTabs } from "./BookTabs";
import { FilesDetails } from "./FilesDetails";
import { Hero } from "./Hero";
import { Highlights } from "./Highlights";
import { Journal } from "./Journal";
import { bookQuery } from "./queries";
import { Related } from "./Related";
import { ReviewsTab } from "./ReviewsTab";
import { YourReading } from "./YourReading";
import "./BookDetail.css";
import "./BookPage.css";

/** Whether the element is out of the viewport, so a drifting backdrop can stop. */
function useOffscreen(target: RefObject<HTMLElement | null>) {
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || !("IntersectionObserver" in window)) return;
    const watch = new IntersectionObserver(([entry]) =>
      setOffscreen(!entry?.isIntersecting),
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [target]);
  return offscreen;
}

/** The cover, blurred and tinted behind the hero; a book with none gets its accent instead. */
function Backdrop({ book }: { book: Detail }) {
  return (
    <div className="bp-backdrop" aria-hidden="true">
      <div className="bp-cam">
        <div className={book.hasCover ? "bp-drift" : "bp-drift is-plain"}>
          {book.hasCover && <img src={coverUrl(book.uuid)} alt="" />}
        </div>
      </div>
      <div className="bp-warm" />
      <div className="bp-shade" />
      <div className="bp-dim" />
    </div>
  );
}

function Page({ book }: { book: Detail }) {
  const { tab, entering, selectTab } = useBookTabs();
  const stage = useRef<HTMLElement>(null);
  const offscreen = useOffscreen(stage);
  return (
    <ToastProvider>
      <div
        className="bp-root"
        style={book.accent ? { "--accent": book.accent } : undefined}
      >
        <PageTitle page={book.title} />
        <header
          ref={stage}
          className={offscreen ? "bp-stage is-offscreen" : "bp-stage"}
          data-tab={tab}
        >
          <Backdrop book={book} />
          <div className="bp-stage-body">
            <Hero book={book} onShowReviews={() => selectTab("reviews")} />
          </div>
        </header>
        <BookTabs
          tab={tab}
          entering={entering}
          onSelect={selectTab}
          panels={{
            overview: (
              <>
                <YourReading book={book} />
                <Related book={book} />
              </>
            ),
            reviews: <ReviewsTab book={book} />,
            highlights: (
              <>
                <Highlights book={book} />
                <Journal book={book} />
              </>
            ),
            files: <FilesDetails book={book} />,
          }}
        />
      </div>
    </ToastProvider>
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
        <Page key={book.data.uuid} book={book.data} />
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
