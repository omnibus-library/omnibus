import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "../../components/Button/Button";
import { MAX_RATE, MIN_RATE } from "../../playback/boot";
import { usePlayback } from "../../playback/PlaybackProvider";
import { clampRate, RATE_STEP } from "./listen";

type DrawerShellProps = {
  testId: string;
  onClose: () => void;
  /** The kicker and title block. */
  head: ReactNode;
  /** Sits beside the close button. */
  actions?: ReactNode;
  children: ReactNode;
};

/** A scrim and the right-hand drawer: head, actions, close button, then the body. */
export function DrawerShell({
  testId,
  onClose,
  head,
  actions,
  children,
}: DrawerShellProps) {
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click-away scrim; "Close" is the keyboard's way out */}
      <div className="lp-scrim" onClick={onClose} />
      <div className="lp-drawer" data-testid={testId}>
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
      </div>
    </>
  );
}

type PanelShellProps = {
  /** The panel's own class, such as `lp-speed-panel`. */
  extraClass: string;
  label: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
};

/** A scrim and a small dialog that takes focus on open, so Escape closes it without a click first. */
export function PanelShell({
  extraClass,
  label,
  testId,
  onClose,
  children,
}: PanelShellProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Escape closes the panel from the keyboard; the scrim is the pointer's way out */}
      <div className="lp-scrim" onClick={onClose} />
      <div
        ref={panel}
        className={`lp-panel ${extraClass}`}
        data-testid={testId}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </>
  );
}

const PRESETS = [0.5, 0.8, 1, 1.1, 1.2, 1.5, 1.8, 2];

/** The speed controls the full player and the mini dock both host: presets, a fine-tune slider and a stepper. */
export function SpeedPanelBody() {
  const { rate, setRate } = usePlayback();
  const apply = (next: number) => setRate(clampRate(next));
  const pct = Math.min(
    100,
    Math.max(0, ((rate - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100),
  ).toFixed(1);
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
