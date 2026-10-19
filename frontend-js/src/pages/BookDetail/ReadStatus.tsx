import { useQuery } from "@tanstack/react-query";
import {
  type BookUuid,
  type ReadStatusRecord,
  type ReadStatusValue,
  saveReadStatus,
} from "../../api";
import { ago, nowSecs } from "../../format";
import { readStatusQuery, shelvesQuery } from "./queries";
import { useOptimisticSave } from "./useOptimisticSave";

const SEGMENTS = [
  ["unread", "Unread"],
  ["reading", "Reading"],
  ["finished", "Finished"],
] as const satisfies readonly (readonly [ReadStatusValue, string])[];

function statusMeta(
  failed: boolean,
  record: ReadStatusRecord | null | undefined,
): string {
  if (failed) return "Couldn't save — try again";
  const status = record?.status ?? "unread";
  switch (status) {
    case "unread":
      return "Not started";
    case "reading":
      return "In progress";
    case "finished":
      return record?.finishedAt
        ? `Finished ${ago(nowSecs(), record.finishedAt)}`
        : "Finished";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** The Unread / Reading / Finished control and the line under it. */
export function ReadStatus({ uuid }: { uuid: BookUuid }) {
  const { queryKey } = readStatusQuery(uuid);
  const record = useQuery(readStatusQuery(uuid));
  const save = useOptimisticSave(
    queryKey,
    (status: ReadStatusValue) => saveReadStatus(uuid, status),
    {
      optimistic: (status) => ({
        status,
        finishedAt: status === "finished" ? nowSecs() : null,
      }),
      // A smart shelf may now hold the book.
      alsoInvalidate: [shelvesQuery(uuid).queryKey],
    },
  );
  // `null` is a read that succeeded with no status; `undefined` is still loading or unreadable.
  const known = record.data !== undefined;
  const shown = known ? (record.data?.status ?? "unread") : null;
  return (
    <div className="bd-readstatus" data-testid="read-status-control">
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets */}
      <div
        className="bd-readstatus-seg"
        role="group"
        aria-label="Reading status"
      >
        {SEGMENTS.map(([status, label]) => (
          <button
            key={status}
            type="button"
            className={
              status === shown
                ? "bd-readstatus-btn active"
                : "bd-readstatus-btn"
            }
            data-testid={`read-status-${status}`}
            aria-pressed={status === shown}
            disabled={!known}
            onClick={() => status !== shown && save.mutate(status)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="mono bd-readstatus-meta"
        role="status"
        data-testid="read-status-meta"
      >
        {known ? (
          statusMeta(save.isError, record.data)
        ) : record.isError ? (
          <>
            Couldn't load your reading status
            <button
              type="button"
              className="bdmq-synclink"
              onClick={() => record.refetch()}
            >
              Retry
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
