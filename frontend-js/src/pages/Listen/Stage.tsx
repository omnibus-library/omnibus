import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { type BookDetail, declareListeningSyncPoint } from "../../api";
import { Button } from "../../components/Button/Button";
import { CoverImage } from "../../components/Cover/CoverImage";
import { BusyLabel, Ring } from "../../components/Loading/Loading";
import { usePlayback } from "../../playback/PlaybackProvider";
import { sleepToolbarLabel } from "../../playback/sleep";
import { formatHmsShort } from "../../resume";
import {
  chapterFillPct,
  chapterIndexForElapsed,
  chapterSubText,
  effectiveScrubPosition,
  kickerText,
  type Pane,
  rateLabel,
  remainingAtRate,
  seekChapter,
  syncLabel,
  thumbPct,
} from "./listen";
import "./Listen.css";

/** The chapter bar over a transparent range that seeks: dragging previews, releasing seeks. */
function ChapterMap() {
  const { chapters, elapsed, duration, rate, buffering, playing, seek } =
    usePlayback();
  const [scrub, setScrub] = useState<number | null>(null);
  const range = useRef<HTMLInputElement>(null);
  // React's onChange fires on every drag step; only the native change event marks the release.
  useEffect(() => {
    const el = range.current;
    const release = () => {
      if (el) seek(el.valueAsNumber);
      setScrub(null);
    };
    el?.addEventListener("change", release);
    return () => el?.removeEventListener("change", release);
  }, [seek]);

  const { position, index, remaining } = effectiveScrubPosition(
    chapters,
    elapsed,
    duration,
    scrub,
  );
  const max = duration > 0 ? duration : 1;
  const thumb = `${thumbPct(position, max).toFixed(3)}%`;
  return (
    <div className="lp-chapter-map">
      <div
        className={
          scrub === null ? "lp-chapter-scrub" : "lp-chapter-scrub scrubbing"
        }
      >
        <div className="lp-chapter-seg-row" data-testid="chapter-map">
          {chapters.length === 0 ? (
            <div className="lp-chapter-seg" style={{ flex: 1 }}>
              <div
                className="lp-chapter-seg-fill"
                style={{
                  width: `${thumbPct(position, duration).toFixed(1)}%`,
                }}
              />
            </div>
          ) : (
            chapters.map((chapter, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per manifest, and two markers can share a start
                key={i}
                className={
                  i === index ? "lp-chapter-seg current" : "lp-chapter-seg"
                }
                style={{ flex: Math.max(chapter.seconds, 0.1) }}
                title={chapter.title}
              >
                <div
                  className="lp-chapter-seg-fill"
                  style={{
                    width: `${chapterFillPct(i, index, position, chapter).toFixed(1)}%`,
                  }}
                />
              </div>
            ))
          )}
        </div>
        <div className="lp-chapter-thumb" style={{ left: thumb }} />
        {scrub !== null && (
          <div className="lp-chapter-bubble" style={{ left: thumb }}>
            {formatHmsShort(position)}
          </div>
        )}
        <input
          ref={range}
          type="range"
          className="lp-chapter-range"
          data-testid="listen-seek"
          aria-label="Seek"
          min={0}
          max={max}
          step={1}
          value={position}
          onChange={(e) => setScrub(e.currentTarget.valueAsNumber)}
        />
      </div>
      {/* Elapsed and total are book time; only the time left is scaled by the speed. */}
      <div className="lp-scrub-times" data-testid="listen-scrub-times">
        <span>{formatHmsShort(position)}</span>
        <span className="lp-scrub-remaining">
          · {formatHmsShort(remainingAtRate(remaining, rate))} remaining
        </span>
        <span>{formatHmsShort(duration)}</span>
      </div>
      {playing && buffering && (
        <div
          className="lp-buffering"
          data-testid="listen-buffering"
          role="status"
        >
          <Ring size="xs" />
          Buffering…
        </div>
      )}
    </div>
  );
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/** Declares the ebook and audiobook aligned at this spot; a direct call, never queued, and offline it is off. */
function SyncHereButton() {
  const { uuid, loadedFileId, elapsed } = usePlayback();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Synced here");
  const sync = async () => {
    if (!uuid) return;
    setBusy(true);
    // The resolved file, not the `?file_id` request: a file-less declaration on a multi-file book is refused.
    const failure = await declareListeningSyncPoint(
      uuid,
      loadedFileId,
      elapsed,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    setLabel(syncLabel(failure));
    setBusy(false);
  };
  return (
    <Button
      size="sm"
      className="lp-toolbar-btn"
      data-testid="listen-sync-here"
      title="Declare the ebook and audiobook aligned at this spot"
      disabled={!online || busy}
      aria-busy={busy}
      onClick={sync}
    >
      <BusyLabel busy={busy} label={label} busyLabel="Syncing…" />
    </Button>
  );
}

/** The cover column and the info column: title, chapter map, transport, toolbar. */
export function Stage({
  book,
  pane,
  onPane,
}: {
  book: BookDetail;
  /** The open pane, which its toolbar button shows as on. */
  pane: Pane | null;
  onPane: (pane: Pane) => void;
}) {
  const p = usePlayback();
  const author = book.creators[0]?.name ?? "Unknown Author";
  const chapterIndex = chapterIndexForElapsed(p.chapters, p.elapsed);
  const chapterSub = chapterSubText(p.chapters, chapterIndex);
  return (
    <div className="lp-stage">
      <div className="lp-cover-col">
        <div className="lp-cover-ring">
          <CoverImage book={book} sizes="(max-width: 720px) 60vw, 360px" />
        </div>
      </div>
      <div className="lp-info-col">
        <div className="lp-kicker">
          {kickerText(p.chapters.length, chapterIndex)}
        </div>
        <Link
          className="lp-booklink"
          to={`/books/${book.uuid}`}
          aria-label={`Open details for ${book.title}`}
        >
          <h1 className="lp-title">{book.title}</h1>
          <div className="lp-author">by {author}</div>
        </Link>
        {chapterSub && <div className="lp-chapter-sub">{chapterSub}</div>}
        <ChapterMap />
        <div className="lp-transport">
          <button
            type="button"
            className="lp-btn-ch"
            disabled={p.chapters.length === 0}
            aria-label="Previous chapter"
            title="Previous chapter"
            onClick={() => seekChapter(p, -1)}
          >
            <span className="lp-ch-bar" />
            <span className="lp-ch-tri-left" />
            <span>CH</span>
          </button>
          <button
            type="button"
            className="lp-btn-skip"
            data-testid="listen-skip-back"
            aria-label="Back 30 seconds"
            onClick={() => p.skip(-30)}
          >
            -30
          </button>
          <button
            type="button"
            className="lp-btn-play"
            data-testid="listen-toggle"
            aria-label={p.playing ? "Pause" : "Play"}
            onClick={p.toggle}
          >
            {p.playing ? (
              <div className="lp-ico-pause">
                <div className="lp-ico-pause-bar" />
                <div className="lp-ico-pause-bar" />
              </div>
            ) : (
              <div className="lp-ico-play" />
            )}
          </button>
          <button
            type="button"
            className="lp-btn-skip"
            data-testid="listen-skip-forward"
            aria-label="Forward 30 seconds"
            onClick={() => p.skip(30)}
          >
            +30
          </button>
          <button
            type="button"
            className="lp-btn-ch"
            disabled={p.chapters.length === 0}
            aria-label="Next chapter"
            title="Next chapter"
            onClick={() => seekChapter(p, 1)}
          >
            <span>CH</span>
            <span className="lp-ch-tri-right" />
            <span className="lp-ch-bar" />
          </button>
          <button
            type="button"
            className={pane === "speed" ? "lp-btn-rate on" : "lp-btn-rate"}
            data-testid="listen-rate"
            aria-label="Playback speed"
            onClick={() => onPane("speed")}
          >
            {rateLabel(p.rate)}
          </button>
          <div className="lp-volume" data-testid="listen-volume">
            <span className="lp-volume-icon" aria-hidden="true">
              🔊
            </span>
            <input
              type="range"
              className="lp-volume-input"
              min={0}
              max={1}
              step={0.05}
              value={p.volume}
              aria-label="Volume"
              onChange={(e) => p.setVolume(e.currentTarget.valueAsNumber)}
            />
            <span className="lp-volume-pct">{Math.round(p.volume * 100)}%</span>
          </div>
        </div>
        <div className="lp-toolbar">
          <Button
            size="sm"
            className={
              pane === "sleep" || p.sleep.remaining !== null
                ? "lp-toolbar-btn on"
                : "lp-toolbar-btn"
            }
            data-testid="listen-sleep"
            onClick={() => onPane("sleep")}
          >
            {sleepToolbarLabel(p.sleep.remaining)}
          </Button>
          <Button
            size="sm"
            className={
              pane === "bookmarks" ? "lp-toolbar-btn on" : "lp-toolbar-btn"
            }
            data-testid="listen-bookmark"
            onClick={() => onPane("bookmarks")}
          >
            Bookmark
          </Button>
          <Button
            size="sm"
            className={
              pane === "chapters" ? "lp-toolbar-btn on" : "lp-toolbar-btn"
            }
            onClick={() => onPane("chapters")}
          >
            {pane === "chapters" ? "Chapters ↓" : "Chapters ↑"}
          </Button>
          <SyncHereButton />
        </div>
      </div>
    </div>
  );
}
