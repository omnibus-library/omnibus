import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
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
import { savedStatus } from "./readout";
import { useOptimisticSave } from "./useOptimisticSave";

const STATUSES = [
  ["unread", "Unread", <UnreadGlyph key="unread" />],
  ["reading", "Reading", <ReadingGlyph key="reading" />],
  ["finished", "Finished", <FinishedGlyph key="finished" />],
] as const satisfies readonly (readonly [ReadStatusValue, string, ReactNode])[];

/** The status pill and its menu of Unread, Reading and Finished; a refused pick reverts and says so. */
export function ReadStatus({
  uuid,
  onFinish,
  onFinishRefused,
}: {
  uuid: BookUuid;
  /** Told when the reader picks Finished after another status. */
  onFinish: () => void;
  /** Told when the server refused that pick, so what it celebrated is taken down. */
  onFinishRefused: () => void;
}) {
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
      onFailure: (status) => {
        toast("Couldn't save your reading status");
        if (status === "finished") onFinishRefused();
      },
    },
  );
  const [open, setOpen] = useState(false);
  // Unknown while loading or unreadable; Unread for a book with no record.
  const shown = savedStatus(record.data);
  const known = shown !== undefined;
  const current = STATUSES.find(([status]) => status === shown);
  return (
    <div className="shd-more bp-status" data-testid="read-status-control">
      <button
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
            onSelect: () => {
              if (status === shown) return;
              if (status === "finished") onFinish();
              save.mutate(status);
            },
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
