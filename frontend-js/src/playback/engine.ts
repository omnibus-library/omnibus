import type { AudioPart } from "../api";
import type { HlsConstructor, HlsInstance } from "./loadHls";

/** The slice of an `<audio>` element the engine drives, so a test can stand in for one. */
export type Media = Pick<
  HTMLMediaElement,
  | "src"
  | "currentTime"
  | "duration"
  | "paused"
  | "readyState"
  | "playbackRate"
  | "volume"
  | "play"
  | "pause"
  | "load"
  | "removeAttribute"
  | "canPlayType"
  | "addEventListener"
  | "removeEventListener"
>;

export type EngineEvents = {
  /** `timeupdate`, only once seeded. */
  time(seconds: number, userActed: boolean): void;
  /** Every user seek. */
  seeked(seconds: number): void;
  /** Direct: the file total across its parts. */
  duration(seconds: number): void;
  play(seconds: number): void;
  pause(seconds: number, userActed: boolean): void;
  /** The last part (direct) or the HLS stream played out. */
  ended(seconds: number): void;
  /** A source is committed to the element: the "ready" signal. */
  booted(): void;
  /** Playing, with too little data to go on. */
  buffering(on: boolean): void;
  /** Buffering with no progress for 15 s: the element is paused, reported once. */
  stalled(): void;
};

const HAVE_FUTURE_DATA = 3;
const STALL_MS = 15_000;
const POLL_MS = 500;
const NATIVE_HLS = "application/vnd.apple.mpegurl";

/**
 * Drives one `<audio>` through a book's parts, or through one HLS stream, and reports
 * positions in seconds into the whole file. Two gates keep a teardown from being saved:
 * until a boot's seed is applied (or the user plays or seeks) nothing is reported, and
 * `userActed` stays false until then, so the restore itself is never written back.
 */
export function createEngine(media: Media, on: EngineEvents) {
  let mode: "direct" | "hls" | null = null;
  let parts: AudioPart[] = [];
  let index = 0;
  let offsets: number[] = [];
  let total = 0;
  let seeded = false;
  let userActed = false;
  // Where a seek that waits on `loadedmetadata` will land: the element's clock reads 0 until then.
  let seed: number | null = null;
  let lastAbs = 0;
  let rate: number | null = null;
  let hls: HlsInstance | null = null;
  let pendingMeta: (() => void) | null = null;
  let playOnLand = false;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastProgressAt = Date.now();
  let stallReported = false;
  const removers: (() => void)[] = [];

  const listen = (
    target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
    type: string,
    handler: (event: Event) => void,
  ) => {
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };

  // A direct file's clock restarts with each part; the whole file's is the part's offset plus it.
  const abs = () =>
    seed ??
    (mode === "direct" ? (offsets[index] ?? 0) : 0) + (media.currentTime || 0);

  // A teardown can fire one last event with the clock already at 0.
  const isTeardownArtifact = (t: number) => t < 1 && lastAbs > 60;

  const partAt = (seconds: number) => {
    let i = 0;
    while (i < offsets.length - 1 && seconds >= (offsets[i + 1] ?? 0)) i++;
    return i;
  };

  const playQuietly = () => void media.play().catch(() => {});

  // Lands `local` on the next `loadedmetadata`; until then positions read as `at`. A newer
  // boot or seek replaces it, keeping any play already owed.
  const landAt = (at: number, local: number, play: boolean) => {
    if (pendingMeta) media.removeEventListener("loadedmetadata", pendingMeta);
    seed = at;
    seeded = true;
    playOnLand ||= play;
    const once = () => {
      media.removeEventListener("loadedmetadata", once);
      pendingMeta = null;
      media.currentTime = local;
      seed = null;
      if (playOnLand) playQuietly();
      playOnLand = false;
    };
    pendingMeta = once;
    media.addEventListener("loadedmetadata", once);
  };

  const markProgress = () => {
    lastProgressAt = Date.now();
    stallReported = false;
  };

  listen(media, "loadedmetadata", () => {
    // A media load() resets the rate to 1, so the tracked one goes back on every load.
    if (rate !== null) media.playbackRate = rate;
    on.duration(mode === "direct" && total > 0 ? total : media.duration || 0);
  });
  listen(media, "timeupdate", () => {
    markProgress();
    if (!seeded || seed !== null) return;
    const t = abs();
    if (isTeardownArtifact(t)) return;
    lastAbs = t;
    on.time(t, userActed);
  });
  listen(media, "progress", markProgress);
  listen(media, "play", () => {
    seeded = true;
    userActed = true;
    on.play(abs());
  });
  listen(media, "pause", () => {
    if (!seeded) return;
    const t = abs();
    if (isTeardownArtifact(t)) return;
    on.pause(t, userActed);
  });
  listen(media, "ended", () => {
    if (mode === "direct" && index + 1 < parts.length) {
      index += 1;
      media.src = parts[index]?.url ?? "";
      media.load();
      playQuietly();
      return;
    }
    on.ended(abs());
  });
  // A page leaving destroys the element; its dying events must not save a position.
  listen(window, "pagehide", () => {
    seeded = false;
  });
  // A page restored from the bfcache missed the pause its hiding fired.
  listen(window, "pageshow", (e) => {
    if (!("persisted" in e && e.persisted)) return;
    seeded = true;
    const t = abs();
    if (media.paused && !isTeardownArtifact(t)) on.pause(t, userActed);
  });

  const startWatchdog = () => {
    markProgress();
    watchdog = setInterval(() => {
      const buffering = !media.paused && media.readyState < HAVE_FUTURE_DATA;
      on.buffering(buffering);
      if (!buffering) {
        markProgress();
        return;
      }
      if (!stallReported && Date.now() - lastProgressAt > STALL_MS) {
        stallReported = true;
        media.pause();
        on.stalled();
      }
    }, POLL_MS);
  };

  const reset = () => {
    hls?.destroy();
    hls = null;
    mode = null;
    parts = [];
    index = 0;
    offsets = [];
    total = 0;
    seeded = false;
    userActed = false;
    seed = null;
    lastAbs = 0;
    clearInterval(watchdog);
    watchdog = undefined;
    if (pendingMeta) media.removeEventListener("loadedmetadata", pendingMeta);
    pendingMeta = null;
    playOnLand = false;
  };

  const seek = (seconds: number) => {
    if (mode === null) return;
    seeded = true;
    userActed = true;
    const s = Math.max(0, seconds || 0);
    lastAbs = s;
    on.seeked(s);
    const i = mode === "direct" ? partAt(s) : 0;
    const local = s - (offsets[i] ?? 0);
    if (i === index && seed === null) {
      media.currentTime = local;
      return;
    }
    // A boot seek or part swap still waiting on metadata gives way to this one.
    landAt(s, local, !media.paused);
    if (i === index) return;
    index = i;
    media.src = parts[i]?.url ?? "";
    media.load();
  };

  // Reset first: the pause this fires is the teardown's, not a listening position.
  const stop = () => {
    reset();
    media.pause();
    media.removeAttribute("src");
    media.load();
  };

  return {
    /** Loads a file's parts, starting at `resumeAt` seconds in; `null` starts at 0 unseeded. */
    initDirect(list: AudioPart[], resumeAt: number | null) {
      reset();
      mode = "direct";
      parts = list;
      let sum = 0;
      offsets = list.map((p) => {
        const start = sum;
        sum += p.seconds || 0;
        return start;
      });
      total = sum;
      on.duration(total);
      const start = Math.max(0, resumeAt ?? 0);
      index = partAt(start);
      const first = list[index];
      if (!first) return;
      if (resumeAt !== null) {
        const local = start - (offsets[index] ?? 0);
        landAt(start, local, false);
      }
      media.src = first.url;
      media.load();
      startWatchdog();
      on.booted();
    },

    /** Plays one HLS stream; `false` when this browser can play neither through hls.js nor natively. */
    initHls(
      url: string,
      resumeAt: number | null,
      Hls: HlsConstructor | undefined,
    ) {
      reset();
      mode = "hls";
      if (Hls?.isSupported()) {
        hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(media);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // A fatal transport error is not a listening position.
          if (data.fatal) on.pause(media.currentTime || 0, false);
        });
      } else if (media.canPlayType(NATIVE_HLS)) {
        media.src = url;
        media.load();
      } else {
        mode = null;
        return false;
      }
      // Zero is a real position (a fresh book); null, a resume in another file, stays unseeded.
      if (resumeAt === 0) seeded = true;
      else if (resumeAt !== null) {
        landAt(resumeAt, resumeAt, false);
      }
      startWatchdog();
      on.booted();
      return true;
    },

    /** Where the playhead stands, and whether the listener has acted since the boot. */
    where: () => ({ seconds: abs(), userActed }),
    pause: () => media.pause(),
    toggle() {
      if (mode === null) return;
      if (media.paused) playQuietly();
      else media.pause();
    },
    seek,
    skip: (delta: number) => seek(abs() + delta),
    setRate(next: number) {
      rate = next;
      media.playbackRate = next;
    },
    setVolume(volume: number) {
      media.volume = volume;
    },
    stop,
    /** Stops, and lets go of every listener and the stall poll. */
    dispose() {
      stop();
      for (const remove of removers.splice(0)) remove();
    },
  };
}
