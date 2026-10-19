import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { BookDetail } from "../../api";
import { Button } from "../../components/Button/Button";
import { CoverImage } from "../../components/Cover/CoverImage";
import { Ring } from "../../components/Loading/Loading";
import { usePlayback } from "../../playback/PlaybackProvider";
import {
  chapterFillPct,
  chapterIndexForElapsed,
  chapterNextTarget,
  chapterPrevTarget,
  chapterSubText,
  effectiveScrubPosition,
  formatHms,
  kickerText,
  noChapterFillPct,
  type Pane,
  rateLabel,
  remainingAtRate,
  thumbPct,
} from "./listen";

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
                  width: `${noChapterFillPct(position, duration).toFixed(1)}%`,
                }}
              />
            </div>
          ) : (
            chapters.map((chapter, i) => (
              <div
                key={chapter.start}
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
            {formatHms(position)}
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
        <span>{formatHms(position)}</span>
        <span className="lp-scrub-remaining">
          · {formatHms(remainingAtRate(remaining, rate))} remaining
        </span>
        <span>{formatHms(duration)}</span>
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
            onClick={() => {
              const target = chapterPrevTarget(
                p.chapters,
                p.elapsed,
                chapterIndex,
              );
              if (target !== null) p.seek(target);
            }}
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
            onClick={() => {
              const target = chapterNextTarget(p.chapters, chapterIndex);
              if (target !== null) p.seek(target);
            }}
          >
            <span>CH</span>
            <span className="lp-ch-tri-right" />
            <span className="lp-ch-bar" />
          </button>
          <button
            type="button"
            className="lp-btn-rate"
            data-testid="listen-rate"
            aria-label="Playback speed"
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
        </div>
      </div>
    </div>
  );
}
