import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine, type Media } from "./engine";
import type { HlsConstructor } from "./loadHls";

/** An `<audio>` stand-in: settable fields, recorded calls, and a `load()` that resets the rate as a real one does. */
class FakeMedia extends EventTarget {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  readyState = 4;
  playbackRate = 1;
  volume = 1;
  native = false;
  calls: string[] = [];

  play() {
    this.calls.push("play");
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.calls.push("pause");
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  load() {
    this.calls.push("load");
    this.playbackRate = 1;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  canPlayType() {
    return this.native ? "maybe" : "";
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

const PARTS = [
  { url: "/p1", seconds: 100 },
  { url: "/p2", seconds: 100 },
  { url: "/p3", seconds: 100 },
];

function setup() {
  const media = new FakeMedia();
  const on = {
    time: vi.fn(),
    seeked: vi.fn(),
    duration: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    ended: vi.fn(),
    booted: vi.fn(),
    buffering: vi.fn(),
    stalled: vi.fn(),
  };
  const engine = createEngine(media as unknown as Media, on);
  return { media, on, engine };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("initDirect", () => {
  it("starts in the part the resume lands in and seeks into it once its metadata loads", () => {
    const { media, on, engine } = setup();

    engine.initDirect(PARTS, 250);

    expect(media.src).toBe("/p3");
    expect(on.duration).toHaveBeenCalledWith(300);
    expect(on.booted).toHaveBeenCalledOnce();
    media.fire("loadedmetadata");
    expect(media.currentTime).toBe(50);
  });

  it("applies no seek and reports no position until the user plays or seeks, with no resume", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, null);
    media.fire("loadedmetadata");
    expect(media.currentTime).toBe(0);

    media.fire("timeupdate");
    expect(on.time).not.toHaveBeenCalled();

    media.currentTime = 5;
    media.fire("play");
    media.fire("timeupdate");
    expect(on.time).toHaveBeenCalledWith(5, true);
  });

  it("tells a restore from the user: time carries userActed false until a play", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 40);
    media.fire("loadedmetadata");

    media.fire("timeupdate");
    expect(on.time).toHaveBeenLastCalledWith(40, false);
    media.fire("play");
    media.fire("timeupdate");
    expect(on.time).toHaveBeenLastCalledWith(40, true);
  });
});

describe("a boot whose resume seek has not landed", () => {
  const BIG = [{ url: "/p", seconds: 10_800 }];

  it("reports the resume position to a play and pause before metadata", () => {
    const { media, on, engine } = setup();
    engine.initDirect(BIG, 7200);

    media.play();
    media.pause();

    expect(on.pause).toHaveBeenCalledWith(7200, true);
  });

  it("lands a skip on the resume plus the delta once metadata loads", () => {
    const { media, on, engine } = setup();
    engine.initDirect(BIG, 7200);

    engine.skip(30);
    media.fire("loadedmetadata");

    expect(on.seeked).toHaveBeenCalledWith(7230);
    expect(media.currentTime).toBe(7230);
  });

  it("lets a seek replace the boot seek of an hls stream", () => {
    const { media, on, engine } = setup();
    engine.initHls("/m3u8", 600, fakeHls(true).Hls);

    engine.seek(900);
    media.fire("loadedmetadata");

    expect(on.seeked).toHaveBeenCalledWith(900);
    expect(media.currentTime).toBe(900);
  });
});

describe("seek", () => {
  it("only sets the time when the target is in the current part", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.calls = [];

    engine.seek(60);

    expect(media.currentTime).toBe(60);
    expect(media.calls).toEqual([]);
    expect(on.seeked).toHaveBeenCalledWith(60);
  });

  it("swaps to another part and sets the local time on its metadata, resuming only if it was playing", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");

    engine.seek(150);
    expect(on.seeked).toHaveBeenCalledWith(150);
    expect(media.src).toBe("/p2");
    media.calls = [];
    media.fire("loadedmetadata");
    expect(media.currentTime).toBe(50);
    expect(media.calls).toEqual([]);

    media.paused = false;
    engine.seek(250);
    media.fire("loadedmetadata");
    expect(media.src).toBe("/p3");
    expect(media.calls).toEqual(["load", "play"]);
  });

  it("keeps the resume-play when a second seek replaces a part swap still waiting on metadata", () => {
    const { media, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.paused = false;

    engine.seek(150);
    media.paused = true; // what a real load() does, with no pause event
    engine.seek(160);
    media.calls = [];
    media.fire("loadedmetadata");

    expect(media.currentTime).toBe(60);
    expect(media.calls).toEqual(["play"]);
  });

  it("lands skip(-30) from 10 s into part 2 at 80 s of part 1", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 110);
    media.fire("loadedmetadata");
    expect(media.currentTime).toBe(10);

    engine.skip(-30);

    expect(on.seeked).toHaveBeenCalledWith(80);
    expect(media.src).toBe("/p1");
    media.fire("loadedmetadata");
    expect(media.currentTime).toBe(80);
  });
});

describe("a part swap", () => {
  it("drops the timeupdate the load fires at the part start", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.fire("play");
    on.time.mockClear();

    engine.seek(150);
    media.currentTime = 0;
    media.fire("timeupdate");

    expect(on.time).not.toHaveBeenCalled();
  });
});

describe("setRate", () => {
  it("puts the rate back on every loaded part, since a real load() resets it", () => {
    const { media, engine } = setup();
    engine.initDirect(PARTS, 10);
    engine.setRate(1.5);
    engine.seek(150);
    expect(media.playbackRate).toBe(1);

    media.fire("loadedmetadata");

    expect(media.playbackRate).toBe(1.5);
  });
});

describe("ended", () => {
  it("loads and plays the next part, and reports the end only after the last", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");

    media.fire("ended");
    expect(media.src).toBe("/p2");
    expect(media.calls).toContain("play");
    expect(on.ended).not.toHaveBeenCalled();

    media.fire("ended");
    media.currentTime = 100;
    media.fire("ended");
    expect(on.ended).toHaveBeenCalledWith(300);
  });
});

describe("with no source loaded", () => {
  it("ignores toggle, seek and skip, so nothing is saved or played", () => {
    const { media, on, engine } = setup();

    engine.toggle();
    engine.seek(60);
    engine.skip(30);

    expect(media.calls).toEqual([]);
    expect(on.seeked).not.toHaveBeenCalled();
  });
});

describe("teardown gates", () => {
  it("drops a pause or time reading 0 when the session was far past it", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.fire("play");
    media.currentTime = 90;
    media.fire("timeupdate");
    expect(on.time).toHaveBeenCalledTimes(1);

    media.currentTime = 0;
    media.fire("timeupdate");
    media.fire("pause");

    expect(on.time).toHaveBeenCalledTimes(1);
    expect(on.pause).not.toHaveBeenCalled();
  });

  it("reports nothing after pagehide closes the gate", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.fire("play");

    window.dispatchEvent(new Event("pagehide"));
    media.fire("timeupdate");
    media.fire("pause");

    expect(on.time).not.toHaveBeenCalled();
    expect(on.pause).not.toHaveBeenCalled();
  });

  it("reports a pause that came while the page was hidden once it is restored from the cache", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.fire("play");
    window.dispatchEvent(new Event("pagehide"));
    media.pause();
    expect(on.pause).not.toHaveBeenCalled();

    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    );

    expect(on.pause).toHaveBeenCalledWith(10, true);
  });

  it("drops a restored page's pause when the clock reads 0 far past where the session was", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.fire("play");
    media.currentTime = 90;
    media.fire("timeupdate");
    window.dispatchEvent(new Event("pagehide"));
    media.currentTime = 0;

    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    );

    expect(on.pause).not.toHaveBeenCalled();
  });

  it("passes userActed false to a pause on an untouched boot with a seed", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 40);
    media.fire("loadedmetadata");

    media.fire("pause");

    expect(on.pause).toHaveBeenCalledWith(40, false);
  });
});

describe("stall watchdog", () => {
  it("reports buffering while playing without data, then a stall once after 15 s", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.paused = false;
    media.readyState = 1;

    vi.advanceTimersByTime(500);
    expect(on.buffering).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(16_000);

    expect(on.stalled).toHaveBeenCalledOnce();
    expect(media.paused).toBe(true);
  });

  it("does not stall while progress keeps arriving", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.paused = false;
    media.readyState = 1;

    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(500);
      media.fire("progress");
    }

    expect(on.stalled).not.toHaveBeenCalled();
  });

  it("does not carry the poll over a stop into the next boot", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    engine.stop();
    media.paused = false;
    media.readyState = 1;

    vi.advanceTimersByTime(16_000);

    expect(on.stalled).not.toHaveBeenCalled();
  });

  it("keeps one poll across boots", () => {
    const { engine } = setup();

    engine.initDirect(PARTS, 10);
    engine.initDirect(PARTS, 20);

    expect(vi.getTimerCount()).toBe(1);
  });
});

function fakeHls(supported: boolean) {
  const handlers: ((e: string, d: { fatal?: boolean }) => void)[] = [];
  const instance = {
    loadSource: vi.fn(),
    attachMedia: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((_e: string, h: (typeof handlers)[number]) => handlers.push(h)),
  };
  class Hls {
    static isSupported = () => supported;
    static Events = { ERROR: "hlsError" };
    loadSource = instance.loadSource;
    attachMedia = instance.attachMedia;
    destroy = instance.destroy;
    on = instance.on;
  }
  return { Hls: Hls as unknown as HlsConstructor, instance, handlers };
}

describe("initHls", () => {
  it("attaches hls.js and reports a fatal error as an unattributed pause", () => {
    const { media, on, engine } = setup();
    const { Hls, instance, handlers } = fakeHls(true);
    media.currentTime = 12;

    expect(engine.initHls("/m3u8", null, Hls)).toBe(true);

    expect(instance.loadSource).toHaveBeenCalledWith("/m3u8");
    expect(instance.attachMedia).toHaveBeenCalledWith(media);
    handlers[0]?.("hlsError", { fatal: true });
    expect(on.pause).toHaveBeenCalledWith(12, false);
  });

  it("falls back to native HLS, and fails with neither", () => {
    const { media, engine } = setup();
    media.native = true;
    expect(engine.initHls("/m3u8", null, undefined)).toBe(true);
    expect(media.src).toBe("/m3u8");

    media.native = false;
    expect(engine.initHls("/m3u8", null, undefined)).toBe(false);
  });

  it("seeds at once for 0, on metadata for a position, and not for null", () => {
    const { media, on, engine } = setup();
    const { Hls } = fakeHls(true);

    engine.initHls("/m3u8", 0, Hls);
    media.fire("timeupdate");
    expect(on.time).toHaveBeenCalledTimes(1);

    on.time.mockClear();
    engine.initHls("/m3u8", 30, Hls);
    media.fire("timeupdate");
    expect(on.time).not.toHaveBeenCalled();
    media.fire("loadedmetadata");
    expect(media.currentTime).toBe(30);
    media.fire("timeupdate");
    expect(on.time).toHaveBeenCalledTimes(1);

    on.time.mockClear();
    engine.initHls("/m3u8", null, Hls);
    media.fire("timeupdate");
    expect(on.time).not.toHaveBeenCalled();
  });
});

describe("stop and dispose", () => {
  it("pauses, drops the source and ignores the pause the teardown fires", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);
    media.fire("loadedmetadata");
    media.fire("play");
    media.calls = [];

    engine.stop();

    expect(media.calls).toEqual(["pause", "load"]);
    expect(media.src).toBe("");
    expect(on.pause).not.toHaveBeenCalled();
  });

  it("removes its listeners and the poll", () => {
    const { media, on, engine } = setup();
    engine.initDirect(PARTS, 10);

    engine.dispose();
    media.fire("play");

    expect(on.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
