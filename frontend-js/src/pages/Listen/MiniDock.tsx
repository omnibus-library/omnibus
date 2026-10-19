import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { BookDetail } from "../../api";
import { classes } from "../../classes";
import { CoverImage } from "../../components/Cover/CoverImage";
import { usePlayback } from "../../playback/PlaybackProvider";
import { sleepChipLabel } from "../../playback/sleep";
import {
  chapterIndexForElapsed,
  chapterNextTarget,
  chapterPrevTarget,
  chapterSubText,
  type DockPanel,
  dockBook,
  dockSubText,
  thumbPct,
  togglePanel,
} from "./listen";
import { SleepPanelBody, SpeedPanelBody } from "./Panels";

function Icon({
  strokeWidth = 1.8,
  children,
}: {
  strokeWidth?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Always in the DOM so it can animate; inert while shut, so its controls take no focus. */
function Popover({
  open,
  testId,
  extraClass,
  children,
}: {
  open: boolean;
  testId: string;
  extraClass: string;
  children: ReactNode;
}) {
  return (
    <div
      className={classes(
        open ? "mini-dock-pop open" : "mini-dock-pop",
        extraClass,
      )}
      data-testid={testId}
      inert={!open}
    >
      {children}
    </div>
  );
}

type Toggle = { open: boolean; onToggle: () => void };

function DockVolume({ open, onToggle }: Toggle) {
  const { volume, setVolume } = usePlayback();
  const pct = Math.round(volume * 100);
  return (
    <div className="mini-dock-pop-anchor mini-dock-hide">
      <button
        type="button"
        className={open ? "mini-dock-ico on" : "mini-dock-ico"}
        data-testid="mini-dock-volume"
        aria-label="Volume"
        aria-expanded={open}
        title="Volume"
        onClick={onToggle}
      >
        <Icon strokeWidth={1.7}>
          <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
        </Icon>
      </button>
      <Popover
        open={open}
        testId="mini-dock-pop-vol"
        extraClass="mini-dock-pop-vol"
      >
        <div className="mini-dock-vol-vert">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            style={{ "--p": `${pct}%` }}
            aria-label="Volume"
            onChange={(e) => setVolume(e.currentTarget.valueAsNumber)}
          />
          <div className="mono">{pct}</div>
        </div>
      </Popover>
    </div>
  );
}

function DockSpeed({ open, onToggle }: Toggle) {
  const { rate } = usePlayback();
  return (
    <div className="mini-dock-pop-anchor">
      <button
        type="button"
        className={
          open
            ? "mini-dock-chip mono mini-dock-hide on"
            : "mini-dock-chip mono mini-dock-hide"
        }
        data-testid="mini-dock-speed"
        aria-label="Playback speed"
        aria-expanded={open}
        title="Change playback speed"
        onClick={onToggle}
      >
        {rate.toFixed(1)}×
      </button>
      <Popover
        open={open}
        testId="mini-dock-pop-speed"
        extraClass="mini-dock-pop-speed"
      >
        <SpeedPanelBody />
      </Popover>
    </div>
  );
}

function DockSleep({ open, onToggle }: Toggle) {
  const { sleep } = usePlayback();
  return (
    <div className="mini-dock-pop-anchor">
      <button
        type="button"
        className={
          open
            ? "mini-dock-chip mini-dock-hide on"
            : "mini-dock-chip mini-dock-hide"
        }
        data-testid="mini-dock-sleep"
        aria-label="Sleep timer"
        aria-expanded={open}
        title="Sleep timer"
        onClick={onToggle}
      >
        {sleepChipLabel(sleep.remaining, sleep.choice)}
      </button>
      <Popover
        open={open}
        testId="mini-dock-pop-sleep"
        extraClass="mini-dock-pop-sleep"
      >
        <SleepPanelBody />
      </Popover>
    </div>
  );
}

/** `[⟨CH] [-30] [play] [+30] [CH⟩]`; the narrow-viewport rule sheds all but play. */
function DockTransport() {
  const p = usePlayback();
  const index = chapterIndexForElapsed(p.chapters, p.elapsed);
  const prev = chapterPrevTarget(p.chapters, p.elapsed, index);
  const next = chapterNextTarget(p.chapters, index);
  const noChapters = p.chapters.length === 0;
  return (
    <div className="mini-dock-mid">
      <button
        type="button"
        className="mini-dock-ch mini-dock-hide"
        data-testid="mini-dock-ch-prev"
        disabled={noChapters}
        aria-label="Previous chapter"
        title="Previous chapter"
        onClick={() => prev !== null && p.seek(prev)}
      >
        <span className="lp-ch-bar" />
        <span className="lp-ch-tri-left" />
      </button>
      <button
        type="button"
        className="mini-dock-btn mini-dock-skip mini-dock-hide"
        data-testid="mini-dock-skip-back"
        aria-label="Back 30 seconds"
        onClick={() => p.skip(-30)}
      >
        -30
      </button>
      <button
        type="button"
        className="mini-dock-play"
        data-testid="mini-dock-toggle"
        aria-label={p.playing ? "Pause" : "Play"}
        onClick={p.toggle}
      >
        {p.playing ? (
          <div className="mini-dock-ico-pause">
            <div className="mini-dock-ico-pause-bar" />
            <div className="mini-dock-ico-pause-bar" />
          </div>
        ) : (
          <div className="mini-dock-ico-play" />
        )}
      </button>
      <button
        type="button"
        className="mini-dock-btn mini-dock-skip mini-dock-hide"
        data-testid="mini-dock-skip-forward"
        aria-label="Forward 30 seconds"
        onClick={() => p.skip(30)}
      >
        +30
      </button>
      <button
        type="button"
        className="mini-dock-ch mini-dock-hide"
        data-testid="mini-dock-ch-next"
        disabled={noChapters}
        aria-label="Next chapter"
        title="Next chapter"
        onClick={() => next !== null && p.seek(next)}
      >
        <span className="lp-ch-tri-right" />
        <span className="lp-ch-bar" />
      </button>
    </div>
  );
}

function DockBar({ book }: { book: BookDetail }) {
  const p = usePlayback();
  const [panel, setPanel] = useState<DockPanel | null>(null);
  const toggle = (clicked: DockPanel): Toggle => ({
    open: panel === clicked,
    onToggle: () => setPanel((open) => togglePanel(open, clicked)),
  });
  const sub = dockSubText(
    chapterSubText(p.chapters, chapterIndexForElapsed(p.chapters, p.elapsed)),
    p.elapsed,
    p.duration,
    p.rate,
  );
  // Continues the current file: the link names no `file_id`.
  const listenTo = `/listen/${book.uuid}`;
  return (
    <>
      {panel && (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click-away scrim under the bar; the chips toggle their popovers from the keyboard
        <div
          className="mini-dock-scrim"
          data-testid="mini-dock-scrim"
          onClick={() => setPanel(null)}
        />
      )}
      <section
        className="mini-dock"
        style={book.accent ? { "--accent": book.accent } : undefined}
        data-testid="mini-dock"
        aria-label="Now playing"
      >
        <div className="mini-dock-prog">
          <i
            style={{ width: `${thumbPct(p.elapsed, p.duration).toFixed(1)}%` }}
          />
        </div>
        <Link
          className="mini-dock-now"
          to={listenTo}
          data-testid="mini-dock-expand"
          aria-label="Expand player"
        >
          <div className="mini-dock-cover">
            <CoverImage book={book} sizes="38px" />
          </div>
          <div className="mini-dock-meta">
            <div className="mini-dock-title" data-testid="mini-dock-title">
              {book.title}
            </div>
            <div className="mini-dock-sub">{sub}</div>
          </div>
        </Link>
        <DockTransport />
        <span className="mini-dock-spacer" />
        <DockVolume {...toggle("volume")} />
        <span className="mini-dock-div mini-dock-hide" />
        <DockSpeed {...toggle("speed")} />
        <DockSleep {...toggle("sleep")} />
        <span className="mini-dock-div" />
        <div className="mini-dock-actions">
          <Link
            className="mini-dock-ico"
            to={listenTo}
            data-testid="mini-dock-expand-btn"
            aria-label="Expand to full player"
            title="Expand to full player"
          >
            <Icon>
              <path d="M8 14l-4 4M4 14v4h4M16 10l4-4M20 10V6h-4" />
            </Icon>
          </Link>
          <button
            type="button"
            className="mini-dock-ico"
            data-testid="mini-dock-dismiss"
            aria-label="Stop and close player"
            title="Close audio — keep reading"
            onClick={p.close}
          >
            <Icon>
              <path d="M6 6l12 12M18 6L6 18" />
            </Icon>
          </button>
        </div>
      </section>
    </>
  );
}

/** The persistent audiobook bar: an empty host until a book is loaded (the shell's `:empty` rules rely on it). */
export function MiniDock() {
  const { book, uuid } = usePlayback();
  const loaded = dockBook(book, uuid);
  return (
    <div className="mini-dock-host">{loaded && <DockBar book={loaded} />}</div>
  );
}
