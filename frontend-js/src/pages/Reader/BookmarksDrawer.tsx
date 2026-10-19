import { useEffect, useState } from "react";
import {
  type Bookmark,
  type BookUuid,
  createBookmark,
  deleteBookmark,
  fetchBookmarks,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Loading } from "../../components/Loading/Loading";
import type { AnnotationBridge } from "./annotations";
import { DrawerShell } from "./DrawerShell";

/** A book's bookmarks, loaded when the drawer or sheet that shows them opens; `null` until they arrive. */
export function useBookmarks(uuid: BookUuid) {
  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBookmarks(uuid).then(
      (saved) => !cancelled && setBookmarks(saved),
      // A list that won't load reads as empty, as in the Dioxus reader.
      () => !cancelled && setBookmarks([]),
    );
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  /** Saves the place; a refused save adds nothing. */
  async function add(position: string, label: string) {
    try {
      const saved = await createBookmark(uuid, {
        position,
        title: label || null,
      });
      setBookmarks((list) => [...(list ?? []), saved]);
    } catch {}
  }

  async function remove(bookmark: Bookmark) {
    try {
      await deleteBookmark(bookmark.id);
    } catch {
      return;
    }
    setBookmarks((list) => list?.filter((b) => b.id !== bookmark.id) ?? null);
  }

  return { bookmarks, add, remove };
}

type RowProps = {
  bookmark: Bookmark;
  /** The phone sheet's row, which draws its flag as an icon. */
  sheet?: boolean;
  onNavigate: (position: string) => void;
  onDelete: (bookmark: Bookmark) => void;
};

/** One saved place: its chapter label, which jumps there, and delete. */
export function BookmarkRow({
  bookmark,
  sheet,
  onNavigate,
  onDelete,
}: RowProps) {
  return (
    <div
      className={sheet ? "rd-bm-row rd-ann-bm" : "rd-bm-row"}
      data-testid={sheet ? "annotations-bookmark-row" : "reader-bookmark-row"}
    >
      <button
        type="button"
        className="rd-bm-main"
        onClick={() => onNavigate(bookmark.position)}
      >
        <span className="rd-bm-flag">
          {sheet ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 4h10v16l-5-3.6L7 20V4z" />
            </svg>
          ) : (
            "⚑"
          )}
        </span>
        <span className="rd-bm-label">{bookmark.title || "Bookmark"}</span>
      </button>
      <button
        type="button"
        className="rd-act sm"
        aria-label="Delete bookmark"
        onClick={() => onDelete(bookmark)}
      >
        ×
      </button>
    </div>
  );
}

type BookmarksDrawerProps = {
  uuid: BookUuid;
  /** Where "+ Bookmark" saves: the reader's current place, `null` until it has one. */
  position: string | null;
  /** The new bookmark's title: the chapter, or "Page N". */
  label: string;
  bridge: AnnotationBridge;
  onClose: () => void;
};

/** The bookmarks drawer: the saved places in the book, and a button to save the current one. */
export function BookmarksDrawer({
  uuid,
  position,
  label,
  bridge,
  onClose,
}: BookmarksDrawerProps) {
  const { bookmarks, add, remove } = useBookmarks(uuid);
  return (
    <DrawerShell
      testId="reader-bookmarks-drawer"
      onClose={onClose}
      head={
        <h4 className="rd-drawer-title">
          Bookmarks{" "}
          <span className="rd-drawer-count">{bookmarks?.length ?? 0}</span>
        </h4>
      }
      actions={
        <Button
          size="sm"
          data-testid="reader-bookmark-add"
          disabled={position === null}
          onClick={() => position !== null && add(position, label)}
        >
          + Bookmark
        </Button>
      }
    >
      <div className="rd-drawer-body">
        {bookmarks === null ? (
          <Loading label="Loading bookmarks" />
        ) : bookmarks.length === 0 ? (
          <div className="rd-drawer-empty">
            No bookmarks yet. Tap + Bookmark to save your place.
          </div>
        ) : (
          bookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              onNavigate={(to) => {
                bridge.navigate(to);
                onClose();
              }}
              onDelete={remove}
            />
          ))
        )}
      </div>
    </DrawerShell>
  );
}
