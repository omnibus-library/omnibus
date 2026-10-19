import { describe, expect, it, vi } from "vitest";
import {
  createSleepTimer,
  endOfChapterAnchor,
  SLEEP_PRESETS,
  type SleepState,
  secondsUntilAnchor,
  sleepChipLabel,
  sleepToolbarLabel,
} from "./sleep";

// Three chapters: 0..300, 300..900, 900..1500.
const chapters = [
  { title: "x", start: 0, seconds: 300 },
  { title: "x", start: 300, seconds: 600 },
  { title: "x", start: 900, seconds: 600 },
];

function aTimer(volume = 0.8) {
  const sink = {
    pause: vi.fn(),
    setVolume: vi.fn(),
    targetVolume: () => volume,
  };
  let state: SleepState | undefined;
  const timer = createSleepTimer(sink, (next) => {
    state = next;
  });
  return { timer, sink, state: () => state };
}

describe("labels", () => {
  it("shows the toolbar countdown only while armed", () => {
    expect(sleepToolbarLabel(null)).toBe("Sleep · off");
    expect(sleepToolbarLabel(0)).toBe("Sleep · off");
    expect(sleepToolbarLabel(1722)).toBe("Sleep · 28:42");
  });

  it("shows the chip bare when off, counting for a preset, tagged for end of chapter", () => {
    expect(sleepChipLabel(null, { kind: "off" })).toBe("Sleep");
    expect(sleepChipLabel(1722, { kind: "preset", seconds: 1800 })).toBe(
      "Sleep · 28:42",
    );
    expect(sleepChipLabel(311, { kind: "endOfChapter" })).toBe(
      "Sleep · End of ch.",
    );
  });

  it("starts the presets at Off and runs to four hours", () => {
    expect(SLEEP_PRESETS[0]).toEqual(["Off", 0]);
    expect(SLEEP_PRESETS.at(-1)).toEqual(["4 hours", 14_400]);
  });
});

describe("endOfChapterAnchor", () => {
  it("is the end of the chapter under the playhead, fixed while it plays out", () => {
    expect(endOfChapterAnchor(chapters, 120)).toBe(300);
    for (const now of [301, 500, 880, 899.9]) {
      expect(endOfChapterAnchor(chapters, now)).toBe(900);
    }
    expect(endOfChapterAnchor(chapters, 1000)).toBe(1500);
  });

  it("never names a boundary behind the playhead, or one it can't place", () => {
    expect(endOfChapterAnchor(chapters, 1500)).toBeNull();
    expect(endOfChapterAnchor(chapters, 9999)).toBeNull();
    expect(endOfChapterAnchor([], 420)).toBeNull();
  });
});

describe("secondsUntilAnchor", () => {
  it("counts wall time at the rate, rounded up", () => {
    expect(secondsUntilAnchor(900, 420, 1)).toBe(480);
    expect(secondsUntilAnchor(900, 420, 2)).toBe(240);
    expect(secondsUntilAnchor(900, 420, 0)).toBe(480);
    expect(secondsUntilAnchor(900, 419.5, 1)).toBe(481);
  });

  it("floors at zero once the playhead arrives", () => {
    expect(secondsUntilAnchor(900, 900, 1)).toBe(0);
    expect(secondsUntilAnchor(900, 901, 1)).toBe(0);
  });
});

describe("a duration timer", () => {
  it("counts down once per tick", () => {
    const { timer, state } = aTimer();
    timer.sleepFor(900);
    expect(state()).toMatchObject({
      remaining: 900,
      choice: { kind: "preset", seconds: 900 },
    });

    timer.tick();
    timer.tick();

    expect(state()?.remaining).toBe(898);
  });

  it("fades the listener's own volume over the last 30 seconds", () => {
    const { timer, sink } = aTimer(0.8);
    timer.sleepFor(32);

    timer.tick(); // 31: not yet
    expect(sink.setVolume).not.toHaveBeenCalled();
    timer.tick(); // 30
    expect(sink.setVolume).toHaveBeenLastCalledWith(0.8);
    timer.tick(); // 29
    expect(sink.setVolume).toHaveBeenLastCalledWith((0.8 * 29) / 30);
  });

  it("holds the volume when the fade is off", () => {
    const { timer, sink } = aTimer();
    timer.toggleFade();
    sink.setVolume.mockClear();
    timer.sleepFor(5);

    timer.tick();

    expect(sink.setVolume).not.toHaveBeenCalled();
  });

  it("pauses at zero, restores the volume and turns itself off", () => {
    const { timer, sink, state } = aTimer(0.6);
    timer.sleepFor(1);

    timer.tick();

    expect(sink.pause).toHaveBeenCalledOnce();
    expect(sink.setVolume).toHaveBeenLastCalledWith(0.6);
    expect(state()).toMatchObject({ remaining: null, choice: { kind: "off" } });
  });

  it("restores the listener's volume when cancelled, and when the fade is turned off", () => {
    const { timer, sink } = aTimer(0.6);
    timer.sleepFor(900);
    timer.off();
    expect(sink.setVolume).toHaveBeenLastCalledWith(0.6);

    sink.setVolume.mockClear();
    timer.toggleFade(); // on -> off
    expect(sink.setVolume).toHaveBeenLastCalledWith(0.6);
    sink.setVolume.mockClear();
    timer.toggleFade(); // off -> on
    expect(sink.setVolume).not.toHaveBeenCalled();
  });

  it("treats a preset of 0 as off", () => {
    const { timer, state } = aTimer();
    timer.sleepFor(900);

    timer.sleepFor(0);

    expect(state()).toMatchObject({ remaining: null, choice: { kind: "off" } });
  });
});

describe("an end-of-chapter timer", () => {
  it("reads wall time to the boundary and does not count down on ticks", () => {
    const { timer, state } = aTimer();
    timer.endOfChapter(chapters, 420, 2);
    expect(state()).toMatchObject({
      remaining: 240,
      choice: { kind: "endOfChapter" },
    });

    timer.tick();

    expect(state()?.remaining).toBe(240);
  });

  it("arms nothing when the chapters can't place the playhead", () => {
    const { timer, state } = aTimer();

    timer.endOfChapter([], 420, 1);

    expect(state()).toBeUndefined();
  });

  it("fires on the playhead reaching the boundary, and stays put until then", () => {
    const { timer, sink, state } = aTimer();
    timer.endOfChapter(chapters, 420, 1);

    timer.position(899, 1);
    expect(sink.pause).not.toHaveBeenCalled();
    expect(state()?.remaining).toBe(1);
    timer.position(900, 1);

    expect(sink.pause).toHaveBeenCalledOnce();
    expect(state()).toMatchObject({ remaining: null, choice: { kind: "off" } });
  });

  it("re-anchors to the chapter a seek lands in, and undoes a fade", () => {
    const { timer, sink, state } = aTimer(0.8);
    timer.endOfChapter(chapters, 420, 1);

    timer.seeked(chapters, 1000, 1);

    expect(state()?.remaining).toBe(500);
    expect(sink.setVolume).toHaveBeenLastCalledWith(0.8);
    timer.position(1499, 1);
    expect(sink.pause).not.toHaveBeenCalled();
  });

  it("fires on a seek past the last chapter", () => {
    const { timer, sink, state } = aTimer();
    timer.endOfChapter(chapters, 420, 1);

    timer.seeked(chapters, 1600, 1);

    expect(sink.pause).toHaveBeenCalledOnce();
    expect(state()?.choice).toEqual({ kind: "off" });
  });

  it("ignores a seek when no end-of-chapter timer is armed", () => {
    const { timer, sink } = aTimer();
    timer.sleepFor(900);

    timer.seeked(chapters, 1600, 1);

    expect(sink.pause).not.toHaveBeenCalled();
  });
});
