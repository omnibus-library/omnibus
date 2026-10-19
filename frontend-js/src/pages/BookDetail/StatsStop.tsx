import { useInfiniteQuery } from "@tanstack/react-query";
import type { BookDetail } from "../../api";
import { Loading } from "../../components/Loading/Loading";
import {
  SessionLog,
  SessionLogError,
  sessionLogQuery,
} from "../../components/SessionLog/SessionLog";
import { useWish } from "./queries";
import { RatingWidget } from "./RatingWidget";

function NoStats({ children }: { children: string }) {
  return (
    <>
      <div className="bdmq-bigquiet" data-testid="bdmq-no-stats">
        No stats yet.
      </div>
      <p className="bdmq-quiet-body">{children}</p>
    </>
  );
}

/** Stop 02: the reader's sittings in the book, and their rating of it. */
export function StatsStop({ book }: { book: BookDetail }) {
  const wish = useWish(book);
  const sessions = useInfiniteQuery({
    ...sessionLogQuery(book.uuid),
    // A wish has no reading to tally.
    enabled: !wish,
  });
  const recorded = sessions.data?.pages[0]?.sittings.length ?? 0;
  return (
    <>
      <div className="bdmq-k">{wish ? "Stats" : "At a glance stats"}</div>
      {wish ? (
        <NoStats>
          Add an ebook or an audiobook to start tracking your reading stats for
          this book.
        </NoStats>
      ) : sessions.isPending ? (
        <Loading
          kind="section"
          className="start"
          label="Tallying your reading"
        />
      ) : sessions.isError && !sessions.data ? (
        <SessionLogError message={sessions.error.message} />
      ) : recorded > 0 ? (
        <>
          <div className="bdmq-k bdmq-logk">Your sessions</div>
          <SessionLog uuid={book.uuid} />
        </>
      ) : (
        <NoStats>
          Open the book and the record starts itself — time, pickups, and pace
          all land here.
        </NoStats>
      )}
      <div className="bdmq-ratingrow" data-testid="bdmq-rating">
        <RatingWidget uuid={book.uuid} />
      </div>
    </>
  );
}
