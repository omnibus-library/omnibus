import { useInfiniteQuery } from "@tanstack/react-query";
import type { BookDetail } from "../../api";
import { Loading } from "../../components/Loading/Loading";
import {
  SessionLog,
  SessionLogError,
  sessionLogQuery,
} from "../../components/SessionLog/SessionLog";
import { RatingWidget } from "./RatingWidget";

/** Stop 02: the reader's sittings in the book, and their rating of it. */
export function StatsStop({ book }: { book: BookDetail }) {
  const sessions = useInfiniteQuery(sessionLogQuery(book.uuid));
  const recorded = sessions.data?.pages[0]?.sittings.length ?? 0;
  return (
    <>
      <div className="bdmq-k">At a glance stats</div>
      {sessions.isPending ? (
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
        <>
          <div className="bdmq-bigquiet" data-testid="bdmq-no-stats">
            No stats yet.
          </div>
          <p className="bdmq-quiet-body">
            Open the book and the record starts itself — time, pickups, and pace
            all land here.
          </p>
        </>
      )}
      <div className="bdmq-ratingrow" data-testid="bdmq-rating">
        <RatingWidget uuid={book.uuid} />
      </div>
    </>
  );
}
