import type { Chapter } from "../api";
import {
  chapterIndexForElapsed,
  remainingAtRate,
} from "../pages/Listen/listen";
import { formatHmsShort } from "../resume";

/** The duration presets, in seconds; 0 is off. */
export const SLEEP_PRESETS = [
  ["Off", 0],
  ["15 min", 900],
  ["30 min", 1800],
  ["45 min", 2700],
  ["1 hour", 3600],
  ["2 hours", 7200],
  ["3 hours", 10_800],
  ["4 hours", 14_400],
] as const;

/** Seconds over which the volume ramps to silence before the timer fires. */
const FADE_SECONDS = 30;

export type SleepChoice =
  | { kind: "off" }
  | { kind: "preset"; seconds: number }
  | { kind: "endOfChapter" };

export type SleepState = {
  /** Seconds left (an estimate, for end of chapter); null while off. */
  remaining: number | null;
  choice: SleepChoice;
  fade: boolean;
};

export const SLEEP_OFF: SleepState = {
  remaining: null,
  choice: { kind: "off" },
  fade: true,
};

/** What the timer acts on: it pauses the player and moves the volume the listener hears. */
export type SleepSink = {
  pause(): void;
  setVolume(volume: number): void;
  /** The listener's own volume, which the fade ramps down from and expiry restores. */
  targetVolume(): number;
};

/** The toolbar's label: the live countdown while armed. */
export const sleepToolbarLabel = (remaining: number | null) =>
  remaining !== null && remaining > 0
    ? `Sleep · ${formatHmsShort(remaining)}`
    : "Sleep · off";

/** The dock chip's label; end of chapter has no honest countdown, so it gets a fixed tag. */
export function sleepChipLabel(
  remaining: number | null,
  choice: SleepChoice,
): string {
  if (remaining === null || remaining <= 0) return "Sleep";
  return choice.kind === "endOfChapter"
    ? "Sleep · End of ch."
    : `Sleep · ${formatHmsShort(remaining)}`;
}

/** Where an end-of-chapter timer armed at `elapsed` pauses: the end of the chapter playing, or null with none ahead. */
export function endOfChapterAnchor(
  chapters: readonly Chapter[],
  elapsed: number,
): number | null {
  const chapter = chapters[chapterIndexForElapsed(chapters, elapsed)];
  if (!chapter) return null;
  const end = chapter.start + chapter.seconds;
  return end > elapsed ? end : null;
}

/** Wall-clock seconds until the playhead reaches `anchor`; a readout only, as the timer fires on position. */
export const secondsUntilAnchor = (
  anchor: number,
  elapsed: number,
  rate: number,
) => Math.ceil(remainingAtRate(Math.max(anchor - elapsed, 0), rate));

/**
 * The sleep timer. A duration timer counts down on `tick()`. End of chapter fires when the
 * playhead reaches its anchor, never on a countdown that can't tell a boundary from a jump.
 */
export function createSleepTimer(
  sink: SleepSink,
  publish: (state: SleepState) => void,
) {
  let state = SLEEP_OFF;
  // The book-time position an end-of-chapter timer pauses at; its readout derives from this.
  let anchor: number | null = null;

  const set = (change: Partial<SleepState>) => {
    state = { ...state, ...change };
    publish(state);
  };
  const restoreVolume = () => sink.setVolume(sink.targetVolume());
  // A re-arm ends the fade the old timer was ramping; from off there is none to end.
  const endFade = () => state.remaining !== null && restoreVolume();
  const disarm = () => {
    anchor = null;
    set({ remaining: null, choice: SLEEP_OFF.choice });
  };
  const expire = () => {
    sink.pause();
    restoreVolume();
    disarm();
  };
  const off = () => {
    disarm();
    restoreVolume();
  };
  const arm = (at: number, elapsed: number, rate: number) => {
    endFade();
    anchor = at;
    set({
      remaining: Math.max(secondsUntilAnchor(at, elapsed, rate), 1),
      choice: { kind: "endOfChapter" },
    });
  };
  // Scaled to the listener's own volume: ramping to 1 would raise anyone sitting lower.
  const fadeOut = () => {
    if (
      state.fade &&
      state.remaining !== null &&
      state.remaining <= FADE_SECONDS
    ) {
      sink.setVolume((sink.targetVolume() * state.remaining) / FADE_SECONDS);
    }
  };

  return {
    /** A preset in seconds; 0 turns the timer off. */
    sleepFor(seconds: number) {
      if (seconds <= 0) return off();
      endFade();
      anchor = null;
      set({ remaining: seconds, choice: { kind: "preset", seconds } });
    },
    off,
    /** A new file of the same book: a duration keeps counting, an end-of-chapter anchor was the old file's. */
    fileChanged() {
      if (state.choice.kind === "endOfChapter") off();
    },
    /** Arms for the end of the chapter at `elapsed`; nothing happens when the chapters can't place it. */
    endOfChapter(chapters: readonly Chapter[], elapsed: number, rate: number) {
      const at = endOfChapterAnchor(chapters, elapsed);
      if (at !== null) arm(at, elapsed, rate);
    },
    /** Turning the fade off undoes a ramp already under way. */
    toggleFade() {
      const wasOn = state.fade;
      set({ fade: !wasOn });
      if (wasOn) restoreVolume();
    },
    /** One second of a duration timer. */
    tick() {
      if (state.choice.kind !== "preset" || state.remaining === null) return;
      set({ remaining: state.remaining - 1 });
      fadeOut();
      if (state.remaining <= 0) expire();
    },
    /** The playhead moved: an end-of-chapter timer fires at its anchor, else refreshes its readout. */
    position(elapsed: number, rate: number) {
      if (state.choice.kind !== "endOfChapter" || anchor === null) return;
      if (elapsed >= anchor) return expire();
      const remaining = secondsUntilAnchor(anchor, elapsed, rate);
      if (remaining !== state.remaining) set({ remaining });
      fadeOut();
    },
    /** The listener jumped: end of chapter moves to the chapter they landed in, or fires past the last one. */
    seeked(chapters: readonly Chapter[], elapsed: number, rate: number) {
      if (state.choice.kind !== "endOfChapter") return;
      const at = endOfChapterAnchor(chapters, elapsed);
      if (at === null) return expire();
      arm(at, elapsed, rate);
    },
  };
}

export type SleepTimer = ReturnType<typeof createSleepTimer>;
