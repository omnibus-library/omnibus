import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import {
  type AudioBookmark,
  type BookUuid,
  createAudioBookmark,
  deleteBookmark,
  fetchAudioBookmarks,
  renameBookmark,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Loading } from "../../components/Loading/Loading";
import { Modal } from "../../components/Modal/Modal";
import { usePlayback } from "../../playback/PlaybackProvider";
import { formatHmsShort } from "../../resume";
import {
  chapterIndexForElapsed,
  chapterLabelAt,
  remainingAtRate,
} from "./listen";
import "./Listen.css";

type DrawerShellProps = {
  label: string;
  testId: string;
  onClose: () => void;
  /** The kicker and title block. */
  head: ReactNode;
  /** Sits beside the close button. */
  actions?: ReactNode;
  children: ReactNode;
};

/** A scrim and the right-hand drawer: head, actions, close button, then the body. Escape or a click away closes. */
function DrawerShell({
  label,
  testId,
  onClose,
  head,
  actions,
  children,
}: DrawerShellProps) {
  return (
    <Modal
      label={label}
      backdropClass="lp-scrim"
      dialogClass="lp-drawer"
      dialogTestId={testId}
      onClose={onClose}
    >
      <div className="lp-drawer-head">
        {head}
        <div className="lp-drawer-head-actions">
          {actions}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close ↓
          </Button>
        </div>
      </div>
      <div className="lp-drawer-body">{children}</div>
    </Modal>
  );
}

type Toast = { time: string; chapter: string };

/**
 * The book's audio bookmarks and the writes on them, with the one just saved (it gets an accent
 * ring) and the toast announcing it. A write that fails leaves the list as it was.
 */
export function useBookmarks(uuid: BookUuid) {
  const { chapters, elapsed } = usePlayback();
  const client = useQueryClient();
  const key = ["audio-bookmarks", uuid];
  const { data, status: queryStatus } = useQuery({
    queryKey: key,
    queryFn: () => fetchAudioBookmarks(uuid),
  });
  const list = data ?? [];
  // A failed refresh keeps the marks already loaded.
  const status = data === undefined ? queryStatus : "success";
  const [freshId, setFreshId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const edit = (change: (rows: AudioBookmark[]) => AudioBookmark[]) =>
    client.setQueryData<AudioBookmark[]>(key, (rows) => change(rows ?? []));
  // shortcut: a failed write is dropped without a word, as on Dioxus; surface it once there is a place to
  return {
    list,
    status,
    freshId,
    toast,
    async add() {
      const made = await createAudioBookmark(uuid, elapsed).catch(() => null);
      if (!made) return;
      edit((rows) => [...rows, made]);
      setFreshId(made.id);
      setToast({
        time: formatHmsShort(elapsed),
        chapter: chapterLabelAt(elapsed, chapters),
      });
    },
    async rename(id: number, title: string | null) {
      await renameBookmark(id, title).then(
        () =>
          edit((rows) => rows.map((b) => (b.id === id ? { ...b, title } : b))),
        () => {},
      );
    },
    async remove(id: number) {
      await deleteBookmark(id).then(
        () => edit((rows) => rows.filter((b) => b.id !== id)),
        () => {},
      );
    },
  };
}

export type Bookmarks = ReturnType<typeof useBookmarks>;

/** The "Bookmark saved" confirmation. */
export function BookmarkToast({ toast }: { toast: Toast }) {
  return (
    <div className="lp-toast" data-testid="bookmark-toast">
      <span className="lp-toast-icon">⚑</span>
      <span className="lp-toast-text">Bookmark saved</span>
      <span className="lp-toast-meta">
        {toast.time} · {toast.chapter}
      </span>
    </div>
  );
}

// Spelled out whole so the style extractor can find each class.
const ROW_CLASS = {
  current: "lp-drawer-row current",
  played: "lp-drawer-row played",
  upcoming: "lp-drawer-row",
};
const GLYPH = { current: "▶", played: "✓", upcoming: null };

/** The table of contents: each chapter played (✓), playing (▶) or still to come, and a click seeks to it. */
export function ChaptersDrawer({ onClose }: { onClose: () => void }) {
  const { chapters, elapsed, rate, seek } = usePlayback();
  const current = chapterIndexForElapsed(chapters, elapsed);
  return (
    <DrawerShell
      label="Chapters"
      testId="chapters-drawer"
      onClose={onClose}
      head={
        <div>
          <div className="lp-panel-kicker">Chapters</div>
          <div className="lp-panel-title">Contents</div>
        </div>
      }
    >
      {chapters.length === 0 ? (
        <div className="lp-drawer-empty">
          <p className="lp-drawer-empty-title">No chapters</p>
          <p className="lp-drawer-empty-detail">
            This audiobook has no embedded chapter markers.
          </p>
        </div>
      ) : (
        chapters.map((chapter, i) => {
          const state =
            i === current ? "current" : i < current ? "played" : "upcoming";
          const left = Math.max(chapter.start + chapter.seconds - elapsed, 0);
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per manifest, and two markers can share a start
              key={i}
              type="button"
              className={ROW_CLASS[state]}
              data-testid={`chapter-row-${state}`}
              onClick={() => seek(chapter.start)}
            >
              <span className="lp-drawer-ord">{GLYPH[state] ?? i + 1}</span>
              <span className="lp-drawer-title">
                {chapter.title || `Chapter ${i + 1}`}
              </span>
              {/* Book time, so the one wall-clock figure is the current row's time left. */}
              <span className="lp-drawer-dur">
                {formatHmsShort(chapter.seconds)}
                {state === "current" && (
                  <span className="lp-drawer-left">
                    {" "}
                    · {formatHmsShort(remainingAtRate(left, rate))} left
                  </span>
                )}
              </span>
            </button>
          );
        })
      )}
    </DrawerShell>
  );
}

function BookmarkRow({
  bookmark,
  fresh,
  bookmarks,
}: {
  bookmark: AudioBookmark;
  fresh: boolean;
  bookmarks: Bookmarks;
}) {
  const { chapters, seek } = usePlayback();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bookmark.title ?? "");
  const commit = () => {
    void bookmarks.rename(bookmark.id, draft.trim() || null);
    setEditing(false);
  };
  return (
    <div
      className={fresh ? "lp-bm-row fresh" : "lp-bm-row"}
      data-testid="bookmark-row"
    >
      <button
        type="button"
        className="lp-bm-main"
        onClick={() => seek(bookmark.seconds)}
      >
        <span className="lp-bm-flag">⚑</span>
        <span className="lp-bm-label">
          {chapterLabelAt(bookmark.seconds, chapters)}
        </span>
        <span className="lp-bm-time">{formatHmsShort(bookmark.seconds)}</span>
      </button>
      <div className="lp-bm-note">
        {editing ? (
          <input
            className="lp-bm-note-input"
            type="text"
            placeholder="Add a note…"
            // biome-ignore lint/a11y/noAutofocus: the field opens because the note was clicked
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            // Blurring is the one way out, so Enter and a click away save the same way.
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : (
          <button
            type="button"
            className="lp-bm-note-text"
            onClick={() => setEditing(true)}
          >
            {bookmark.title ?? (
              <span className="lp-bm-note-empty">Add a note…</span>
            )}
          </button>
        )}
      </div>
      <button
        type="button"
        className="lp-bm-del"
        aria-label="Delete bookmark"
        title="Delete bookmark"
        onClick={() => void bookmarks.remove(bookmark.id)}
      >
        ×
      </button>
    </div>
  );
}

function BookmarksBody({ bookmarks }: { bookmarks: Bookmarks }) {
  const { list, status, freshId } = bookmarks;
  if (status === "pending") {
    return <Loading kind="sheet" label="Loading your bookmarks" />;
  }
  if (status === "error") {
    return (
      <div className="lp-drawer-empty" role="alert">
        <p className="lp-drawer-empty-title">Couldn't load your bookmarks</p>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="lp-drawer-empty">
        <p className="lp-drawer-empty-title">No bookmarks yet</p>
        {/* The toolbar's Bookmark button only opens this drawer; "+ Bookmark" is what saves. */}
        <p className="lp-drawer-empty-detail">
          Tap + Bookmark above to save your place. Add a note to any mark below.
        </p>
      </div>
    );
  }
  return list.map((bookmark) => (
    <BookmarkRow
      key={bookmark.id}
      bookmark={bookmark}
      fresh={freshId === bookmark.id}
      bookmarks={bookmarks}
    />
  ));
}

/** The saved marks: a click seeks to one, its note edits in place, and "+ Bookmark" saves the current spot. */
export function BookmarksDrawer({
  bookmarks,
  onClose,
}: {
  bookmarks: Bookmarks;
  onClose: () => void;
}) {
  const { list, status, add } = bookmarks;
  return (
    <DrawerShell
      label="Bookmarks"
      testId="bookmarks-drawer"
      onClose={onClose}
      head={
        <div>
          <div className="lp-panel-kicker">
            Bookmarks{status === "success" && ` · ${list.length}`}
          </div>
          <div className="lp-panel-title">Your marks</div>
        </div>
      }
      actions={
        <Button size="sm" data-testid="bookmark-add" onClick={() => void add()}>
          + Bookmark
        </Button>
      }
    >
      <BookmarksBody bookmarks={bookmarks} />
    </DrawerShell>
  );
}
