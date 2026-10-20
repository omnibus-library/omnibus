import { MAX_RATE, MIN_RATE } from "../../playback/boot";
import { usePlayback } from "../../playback/PlaybackProvider";
import { SLEEP_PRESETS } from "../../playback/sleep";
import { formatHmsShort } from "../../resume";
import { clampRate, RATE_STEP, thumbPct } from "./listen";
import "./Listen.css";

const PRESETS = [0.5, 0.8, 1, 1.1, 1.2, 1.5, 1.8, 2];

/** The speed controls the full player and the mini dock both host: presets, a fine-tune slider and a stepper. */
export function SpeedPanelBody() {
  const { rate, setRate } = usePlayback();
  const apply = (next: number) => setRate(clampRate(next));
  const pct = thumbPct(rate - MIN_RATE, MAX_RATE - MIN_RATE).toFixed(1);
  return (
    <>
      <div className="lp-panel-head">
        <div>
          <div className="lp-panel-kicker">Playback speed</div>
          <div className="lp-panel-title">Set your pace</div>
        </div>
        <div className="lp-speed-value">{rate.toFixed(1)}×</div>
      </div>
      <div className="lp-speed-grid">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={
              Math.abs(preset - rate) < RATE_STEP / 2
                ? "lp-speed-btn on"
                : "lp-speed-btn"
            }
            onClick={() => apply(preset)}
          >
            {preset.toFixed(1)}×
          </button>
        ))}
      </div>
      <div className="lp-speed-fine">
        <div className="lp-speed-fine-header">
          <span className="label">Fine-tune</span>
          <span className="label">0.5× — 3.0×</span>
        </div>
        <div className="lp-speed-fine-track">
          <div className="lp-speed-fine-ticks">
            {[...Array(11).keys()].map((i) => (
              <div
                key={i}
                className="lp-speed-fine-tick"
                style={{ height: i % 5 === 0 ? 12 : 7 }}
              />
            ))}
          </div>
          <div className="lp-speed-fine-rail" />
          <div className="lp-speed-fine-fill" style={{ width: `${pct}%` }} />
          <div
            className="lp-speed-fine-thumb"
            style={{ left: `calc(${pct}% - 9px)` }}
          />
          <input
            type="range"
            className="lp-scrub-input"
            min={MIN_RATE}
            max={MAX_RATE}
            step={RATE_STEP}
            value={rate}
            aria-label="Fine-tune speed"
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              width: "100%",
              height: "100%",
            }}
            onChange={(e) => apply(e.currentTarget.valueAsNumber)}
          />
        </div>
      </div>
      <div className="lp-speed-stepper">
        <button
          type="button"
          className="lp-speed-step-btn"
          aria-label="Decrease speed"
          onClick={() => apply(rate - RATE_STEP)}
        >
          −
        </button>
        <div className="lp-speed-step-value">
          <div className="mono" style={{ fontSize: 16, color: "var(--ink-0)" }}>
            {rate.toFixed(2)}×
          </div>
          <div className="label" style={{ marginTop: 2 }}>
            0.05 steps
          </div>
        </div>
        <button
          type="button"
          className="lp-speed-step-btn"
          aria-label="Increase speed"
          onClick={() => apply(rate + RATE_STEP)}
        >
          +
        </button>
      </div>
    </>
  );
}

/** The sleep controls the full player and the mini dock both host: presets, end of chapter and the fade. */
export function SleepPanelBody() {
  const { sleep, chapters, sleepFor, sleepAtChapterEnd, toggleFade } =
    usePlayback();
  const counting = sleep.remaining !== null && sleep.remaining > 0;
  return (
    <>
      <div className="lp-panel-head">
        <div>
          <div className="lp-panel-kicker">Sleep timer</div>
          <div className="lp-panel-title">Drift off</div>
        </div>
        <div className="lp-sleep-status">
          <div className="lp-sleep-status-value" data-testid="sleep-status">
            {counting ? formatHmsShort(sleep.remaining ?? 0) : "—"}
          </div>
          <div className="label">{counting ? "remaining" : "inactive"}</div>
        </div>
      </div>
      <div className="lp-sleep-grid">
        {SLEEP_PRESETS.map(([label, seconds]) => {
          const on =
            sleep.choice.kind === "off"
              ? seconds === 0
              : sleep.choice.kind === "preset" &&
                sleep.choice.seconds === seconds;
          return (
            <button
              key={label}
              type="button"
              className={on ? "lp-sleep-btn on" : "lp-sleep-btn"}
              onClick={() => sleepFor(seconds)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={
          sleep.choice.kind === "endOfChapter"
            ? "lp-sleep-eoc on"
            : "lp-sleep-eoc"
        }
        disabled={chapters.length === 0}
        onClick={sleepAtChapterEnd}
      >
        <span className="lp-sleep-eoc-dot" />
        End of chapter
      </button>
      <button
        type="button"
        className={sleep.fade ? "lp-sleep-fade on" : "lp-sleep-fade"}
        aria-pressed={sleep.fade}
        aria-label="Fade out volume"
        onClick={toggleFade}
      >
        <span className="lp-sleep-fade-track">
          <span className="lp-sleep-fade-thumb" />
        </span>
        Fade out volume
      </button>
    </>
  );
}
