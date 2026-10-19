import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BookUuid,
  type ReadStatusRecord,
  type ReadStatusValue,
  saveReadStatus,
} from "../../api";
import { ago, nowSecs } from "../../format";
import { readStatusQuery } from "./queries";

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
  const client = useQueryClient();
  const { queryKey } = readStatusQuery(uuid);
  const record = useQuery(readStatusQuery(uuid));
  const mutationKey = [...queryKey, "save"];
  // A write that finishes while a newer click is in flight must not clobber it.
  const isLatest = () => client.isMutating({ mutationKey }) <= 1;
  const save = useMutation({
    mutationKey,
    mutationFn: (status: ReadStatusValue) => saveReadStatus(uuid, status),
    onMutate: async (status) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData(queryKey) ?? null;
      const optimistic = {
        status,
        finishedAt: status === "finished" ? nowSecs() : null,
      };
      client.setQueryData(queryKey, optimistic);
      return { previous };
    },
    onError: (_error, _status, context) => {
      if (isLatest()) client.setQueryData(queryKey, context?.previous ?? null);
    },
    onSuccess: (saved) => {
      if (!isLatest()) return;
      client.setQueryData(queryKey, saved);
      // A smart shelf may now hold the book.
      void client.invalidateQueries({ queryKey: ["book", uuid, "shelves"] });
    },
  });
  const shown = record.data?.status ?? "unread";
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
        {statusMeta(save.isError, record.data)}
      </div>
    </div>
  );
}
