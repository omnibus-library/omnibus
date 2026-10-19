import { useState } from "react";
import type { BookUuid, Highlight, HighlightColor } from "../../api";
import { classes } from "../../classes";
import { Button } from "../../components/Button/Button";
import { Loading } from "../../components/Loading/Loading";
import type { AnnotationBridge } from "./annotations";
import { BookmarkRow, useBookmarks } from "./BookmarksDrawer";
import { DrawerShell } from "./DrawerShell";
import { ColorChips, HighlightRow } from "./HighlightsDrawer";

type Filter = "all" | "bookmarks" | HighlightColor;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

type AnnotationsSheetProps = {
  uuid: BookUuid;
  /** Where "+ Bookmark" saves; `null` until the reader has a place. */
  position: string | null;
  label: string;
  highlights: Highlight[];
  bridge: AnnotationBridge;
  onRecolor: (highlight: Highlight, color: HighlightColor) => void;
  onDelete: (highlight: Highlight) => void;
  onQuote: (highlight: Highlight) => void;
  onEditNote: (highlight: Highlight) => void;
  onClose: () => void;
};

/** The phone's combined sheet: every bookmark, highlight and note, filtered by kind or color. */
export function AnnotationsSheet({
  uuid,
  position,
  label,
  highlights,
  bridge,
  onClose,
  ...row
}: AnnotationsSheetProps) {
  const { bookmarks, add, remove } = useBookmarks(uuid);
  const [filter, setFilter] = useState<Filter>("all");
  const marks = filter === "all" || filter === "bookmarks" ? bookmarks : [];
  const passages =
    filter === "all"
      ? highlights
      : highlights.filter((h) => h.color === filter);
  const jump = (anchor: string) => {
    bridge.navigate(anchor);
    onClose();
  };

  return (
    <DrawerShell
      testId="reader-annotations-drawer"
      onClose={onClose}
      head={
        <h4 className="rd-drawer-title">
          Annotations{" "}
          <span className="rd-drawer-count">
            {plural(highlights.length, "highlight")} ·{" "}
            {plural(bookmarks?.length ?? 0, "bookmark")}
          </span>
        </h4>
      }
      actions={
        <Button
          size="sm"
          data-testid="reader-annotations-add"
          disabled={position === null || bookmarks === null}
          onClick={() => position !== null && add(position, label)}
        >
          + Bookmark
        </Button>
      }
    >
      <div className="rd-filter-row">
        <button
          type="button"
          className={classes("rd-chip", filter === "all" && "on")}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={classes("rd-chip", filter === "bookmarks" && "on")}
          data-testid="annotations-filter-bookmarks"
          aria-pressed={filter === "bookmarks"}
          onClick={() => setFilter("bookmarks")}
        >
          Bookmarks
        </button>
        <span className="rd-filter-div" />
        <ColorChips
          active={filter === "all" || filter === "bookmarks" ? null : filter}
          onPick={setFilter}
        />
      </div>
      <div className="rd-drawer-body">
        {marks === null ? (
          <Loading label="Loading annotations" />
        ) : marks.length === 0 && passages.length === 0 ? (
          <div className="rd-drawer-empty">
            Nothing here yet. Highlight a passage or tap + Bookmark to save your
            place.
          </div>
        ) : (
          <>
            {marks.map((bookmark) => (
              <BookmarkRow
                key={`bm-${bookmark.id}`}
                sheet
                bookmark={bookmark}
                onNavigate={jump}
                onDelete={remove}
              />
            ))}
            {passages.map((highlight) => (
              <HighlightRow
                key={highlight.id}
                highlight={highlight}
                bridge={bridge}
                onJump={jump}
                {...row}
              />
            ))}
          </>
        )}
      </div>
    </DrawerShell>
  );
}
