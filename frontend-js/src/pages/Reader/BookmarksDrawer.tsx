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
import { Icon } from "./ReaderChrome";

/** A book's bookmarks, loaded when the drawer or sheet that shows them opens; `null` until they arrive. */
export function useBookmarks(uuid: BookUuid) {
  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBookmarks(uuid).then(
      (saved) => !cancelled && setBookmarks(saved),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  /** Saves the place; a refused save adds nothing. Callers wait for the list, which would otherwise replace the new row, and for `adding` to clear. */
  async function add(position: string, label: string) {
    setAdding(true);
    try {
      const saved = await createBookmark(uuid, {
        position,
        title: label || null,
      });
      setBookmarks((list) => [...(list ?? []), saved]);
    } catch {
    } finally {
      setAdding(false);
    }
  }

  async function remove(bookmark: Bookmark) {
    try {
      await deleteBookmark(bookmark.id);
    } catch {
      return;
    }
    setBookmarks((list) => list?.filter((b) => b.id !== bookmark.id) ?? null);
  }

  return { bookmarks, failed, adding, add, remove };
}

type RowProps = {
  bookmark: Bookmark;
  bridge: AnnotationBridge;
  /** The phone sheet's row, which draws its flag as an icon. */
  sheet?: boolean;
  onNavigate: (position: string) => void;
  onDelete: (bookmark: Bookmark) => void;
};

/** One saved place: its chapter label, which jumps there, and delete. */
export function BookmarkRow({
  bookmark,
  bridge,
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
        // A place saved in another format of a mixed book can't be shown here.
        disabled={!bridge.canNavigate(bookmark.position)}
        onClick={() => onNavigate(bookmark.position)}
      >
        <span className="rd-bm-flag">
          {sheet ? (
            <Icon size={16}>
              <path d="M7 4h10v16l-5-3.6L7 20V4z" />
            </Icon>
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
  const { bookmarks, failed, adding, add, remove } = useBookmarks(uuid);
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
          disabled={position === null || bookmarks === null || adding}
          onClick={() => position !== null && add(position, label)}
        >
          + Bookmark
        </Button>
      }
    >
      <div className="rd-drawer-body">
        {failed ? (
          <div className="rd-drawer-empty" role="alert">
            Your bookmarks couldn’t be loaded.
          </div>
        ) : bookmarks === null ? (
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
              bridge={bridge}
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
