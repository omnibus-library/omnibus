import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import {
  type BookUuid,
  coverUrl,
  type BookDetail as Detail,
  parseBookUuid,
  type UserId,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider } from "../../components/Toast/Toast";
import { prefersReducedMotion } from "../../motion";
import { type BookDialog, BookDialogs } from "./BookDialogs";
import { BookTabs, panelId, useBookTabs } from "./BookTabs";
import { FilesDetails } from "./FilesDetails";
import { Hero } from "./Hero";
import { HighlightsJournal } from "./HighlightsJournal";
import { reviewCardId } from "./OtherReviews";
import { Overview } from "./Overview";
import { bookQuery } from "./queries";
import { SERIES_ID } from "./Related";
import { ReviewsTab } from "./ReviewsTab";
import { useMyRating } from "./useMyRating";
import "./BookDetail.css";
import "./BookPage.css";

/** How long a card the hero brought the reader to keeps its glow. */
const FLASH_MS = 1600;

/** Whether the element is out of the viewport, so a drifting backdrop can stop. */
function useOffscreen(target: RefObject<HTMLElement | null>) {
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || !("IntersectionObserver" in window)) return;
    // Entries queue oldest first; the last is where the element is now.
    const watch = new IntersectionObserver((entries) =>
      setOffscreen(!entries.at(-1)?.isIntersecting),
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
  // One queue for every write to your review, whichever control makes it.
  const rating = useMyRating(book.uuid);
  const [dialog, setDialog] = useState<BookDialog | null>(null);
  // Takes the reader to their rating on the Reviews tab, or its composer when the stars can't take focus.
  const leaveReview = async () => {
    await selectTab("reviews");
    const panel = document.getElementById(panelId("reviews"));
    const target =
      panel?.querySelector<HTMLElement>(
        '[data-testid="review-stars"] [tabindex="0"]',
      ) ?? panel?.querySelector<HTMLElement>("textarea");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  };
  // One card glows at a time, for a moment after the hero's chevron brings the reader to it.
  const flashed = useRef<{
    card: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => () => clearTimeout(flashed.current?.timer), []);
  const openReview = async (reader: UserId) => {
    await selectTab("reviews");
    const card = document.getElementById(reviewCardId(reader));
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    if (flashed.current) {
      clearTimeout(flashed.current.timer);
      flashed.current.card.classList.remove("is-flash");
    }
    card.classList.add("is-flash");
    flashed.current = {
      card,
      timer: setTimeout(() => card.classList.remove("is-flash"), FLASH_MS),
    };
  };
  const showSeries = async () => {
    await selectTab("overview");
    document.getElementById(SERIES_ID)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };
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
            <Hero
              book={book}
              rating={rating}
              onShowSeries={showSeries}
              onOpenReview={openReview}
              onOpenDialog={setDialog}
              onLeaveReview={leaveReview}
            />
          </div>
        </header>
        <BookTabs
          tab={tab}
          entering={entering}
          onSelect={selectTab}
          panels={{
            overview: <Overview book={book} onOpenDialog={setDialog} />,
            reviews: <ReviewsTab book={book} rating={rating} />,
            highlights: <HighlightsJournal book={book} />,
            files: <FilesDetails book={book} onOpenDialog={setDialog} />,
          }}
        />
        <BookDialogs
          book={book}
          dialog={dialog}
          onClose={() => setDialog(null)}
        />
        {/* The metadata editor, a sheet over this page, once the book is here to sit under it. */}
        <Outlet />
      </div>
    </ToastProvider>
  );
}

function BookDetailFor({ uuid }: { uuid: BookUuid }) {
  const book = useQuery(bookQuery(uuid));
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  // A merged-away uuid resolves to the surviving book; its page keys are the survivor's.
  useEffect(() => {
    if (book.data && book.data.uuid !== uuid) {
      // Seeded so the survivor's page opens on this answer instead of a loader and a refetch.
      client.setQueryData(bookQuery(book.data.uuid).queryKey, book.data);
      // The rest of the address, `/edit` included, moves with it. Cut at the segment, since the
      // route's uuid is decoded and the address may not be.
      navigate(
        {
          pathname: location.pathname.replace(
            /^\/books\/[^/]+/,
            `/books/${book.data.uuid}`,
          ),
          search: location.search,
        },
        { replace: true, state: location.state },
      );
    }
  }, [book.data, uuid, location, navigate, client]);
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
