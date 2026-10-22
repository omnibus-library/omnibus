import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { type BookUuid, type ReadStatusValue, saveReadStatus } from "../../api";
import {
  ChevronDownGlyph,
  FinishedGlyph,
  ReadingGlyph,
  UnreadGlyph,
} from "../../components/Glyphs/Glyphs";
import { MoreMenu } from "../../components/MoreMenu/MoreMenu";
import { useToast } from "../../components/Toast/Toast";
import { ago, nowSecs } from "../../format";
import { readStatusQuery, shelvesQuery } from "./queries";
import { useOptimisticSave } from "./useOptimisticSave";

const STATUSES = [
  ["unread", "Unread", <UnreadGlyph key="unread" />],
  ["reading", "Reading", <ReadingGlyph key="reading" />],
  ["finished", "Finished", <FinishedGlyph key="finished" />],
] as const satisfies readonly (readonly [ReadStatusValue, string, ReactNode])[];

/** The status pill and its menu of Unread, Reading and Finished; a refused pick reverts and says so. */
export function ReadStatus({ uuid }: { uuid: BookUuid }) {
  const toast = useToast();
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
      onFailure: () => toast("Couldn't save your reading status"),
    },
  );
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // `null` is a read that succeeded with no status; `undefined` is still loading or unreadable.
  const known = record.data !== undefined;
  const shown = known ? (record.data?.status ?? "unread") : null;
  const current = STATUSES.find(([status]) => status === shown);
  return (
    <div className="shd-more bp-status" data-testid="read-status-control">
      <button
        ref={trigger}
        type="button"
        className="bp-button bp-button-large bp-tinted bp-status-pill"
        aria-label={`Read status: ${current?.[1] ?? "loading"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!known}
        onClick={() => setOpen(!open)}
      >
        {current ? (
          <span>
            {current[2]}
            {current[1]}
          </span>
        ) : (
          <span className="ld-sheen">Reading status</span>
        )}
        <ChevronDownGlyph />
      </button>
      {open && (
        <MoreMenu
          label="Read status"
          radio
          onClose={() => setOpen(false)}
          items={STATUSES.map(([status, label, icon]) => ({
            label,
            icon,
            testId: `read-status-${status}`,
            checked: status === shown,
            note:
              status === "finished" && record.data?.finishedAt
                ? ago(nowSecs(), record.data.finishedAt)
                : undefined,
            onSelect: () => status !== shown && save.mutate(status),
          }))}
        />
      )}
      {record.isError && (
        <span className="bp-status-error" data-testid="read-status-meta">
          Couldn't load your reading status
          <button
            type="button"
            className="bdmq-synclink"
            onClick={() => record.refetch()}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
