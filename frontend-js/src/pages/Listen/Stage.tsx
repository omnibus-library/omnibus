import { Link } from "react-router";
import type { BookDetail } from "../../api";
import { CoverImage } from "../../components/Cover/CoverImage";
import { usePlayback } from "../../playback/PlaybackProvider";
import {
  chapterIndexForElapsed,
  formatHms,
  kickerText,
  rateLabel,
} from "./listen";

/** The cover column and the info column: title, scrubber times, transport. */
export function Stage({ book }: { book: BookDetail }) {
  const p = usePlayback();
  const author = book.creators[0]?.name ?? "Unknown Author";
  return (
    <div className="lp-stage">
      <div className="lp-cover-col">
        <div className="lp-cover-ring">
          <CoverImage book={book} sizes="(max-width: 720px) 60vw, 360px" />
        </div>
      </div>
      <div className="lp-info-col">
        <div className="lp-kicker">
          {kickerText(
            p.chapters.length,
            chapterIndexForElapsed(p.chapters, p.elapsed),
          )}
        </div>
        <Link
          className="lp-booklink"
          to={`/books/${book.uuid}`}
          aria-label={`Open details for ${book.title}`}
        >
          <h1 className="lp-title">{book.title}</h1>
          <div className="lp-author">by {author}</div>
        </Link>
        <div className="lp-chapter-map">
          <div className="lp-scrub-times" data-testid="listen-scrub-times">
            <span>{formatHms(p.elapsed)}</span>
            <span>{formatHms(p.duration)}</span>
          </div>
        </div>
        <div className="lp-transport">
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
      </div>
    </div>
  );
}
