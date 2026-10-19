import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { type BookUuid, fetchSessionLog, type SessionLogPage } from "../../api";
import { durationLabel, formatStarted } from "../../format";
import { BusyLabel, RowSkeletons } from "../Loading/Loading";
import "./SessionLog.css";

type Sitting = SessionLogPage["sittings"][number];

const FORMAT_LABEL = {
  reading: "Read",
  listening: "Listened",
  mixed: "Read & listened",
} satisfies Record<Sitting["format"], string>;

/** The reader's sittings in one book, a page at a time, newest first. */
export const sessionLogQuery = (uuid: BookUuid) =>
  infiniteQueryOptions({
    queryKey: ["book", uuid, "sessions"],
    queryFn: ({ pageParam }) => fetchSessionLog(uuid, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  });

/** The list of sittings behind a book's stats, with a Show more for the next page. */
export function SessionLog({ uuid }: { uuid: BookUuid }) {
  const log = useInfiniteQuery(sessionLogQuery(uuid));
  const sittings = log.data?.pages.flatMap((page) => page.sittings) ?? [];
  return (
    <div className="st-log st-log-compact" data-testid="session-log">
      {log.isPending ? (
        <div className="st-log-placeholder" data-testid="session-log-loading">
          <RowSkeletons count={3} avatar={false} />
        </div>
      ) : sittings.length === 0 && !log.isError ? (
        <p className="st-log-empty" data-testid="session-log-empty">
          No sittings recorded yet.
        </p>
      ) : (
        <ul className="st-log-list" data-testid="session-log-list">
          {sittings.map((s) => (
            <li
              key={`${s.bookUuid}-${s.startedAt}`}
              className="st-log-row"
              data-testid="session-log-row"
            >
              <div className="mono st-log-when">
                {formatStarted(s.startedAt)}
              </div>
              <div className="st-log-mid">
                <div className="st-log-format">{FORMAT_LABEL[s.format]}</div>
              </div>
              <div className="mono st-log-dur">{durationLabel(s.seconds)}</div>
            </li>
          ))}
        </ul>
      )}
      {log.hasNextPage && (
        <button
          type="button"
          className="st-log-more"
          data-testid="session-log-more"
          disabled={log.isFetchingNextPage}
          aria-busy={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          <BusyLabel
            busy={log.isFetchingNextPage}
            label="Show more"
            busyLabel="Loading…"
          />
        </button>
      )}
      {log.isError && (
        <p
          className="st-log-error"
          role="alert"
          data-testid="session-log-error"
        >
          Couldn't load your session log: {log.error.message}
        </p>
      )}
    </div>
  );
}
