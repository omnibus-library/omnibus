import {
  skipToken,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type BookDetail,
  type BookUuid,
  type Chapter,
  fetchAudioManifest,
  fetchListeningResume,
  fetchListeningRow,
  fetchPlaybackRate,
  fetchTranscodeState,
  postSessions,
  type SessionReport,
  saveListeningPosition,
  savePlaybackRate,
} from "../api";
import { applyAutoReadStatus } from "../autoReadStatus";
import { nowSecs } from "../format";
import {
  bookQuery,
  readStatusQuery,
  shelvesQuery,
} from "../pages/BookDetail/queries";
import { SessionTracker } from "../readingSession";
import { meQuery } from "../session";
import {
  bootResumePosition,
  createPositionSaver,
  loadLocalPosition,
  loadLocalRate,
  loadVolume,
  needsReload,
  resolveFollowBoot,
  resolveRate,
  saveLocalPosition,
  saveLocalRate,
  saveVolume,
} from "./boot";
import { createEngine, type EngineEvents } from "./engine";
import { loadHls } from "./loadHls";
import {
  createSleepTimer,
  SLEEP_OFF,
  type SleepState,
  type SleepTimer,
} from "./sleep";

export type BookState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; book: BookDetail };

type State = {
  uuid: BookUuid | null;
  /** The audio file the manifest resolved; what a saved position must name. */
  loadedFileId: number | null;
  /** A source is committed to the element. */
  ready: boolean;
  failed: boolean;
  buffering: boolean;
  playing: boolean;
  elapsed: number;
  duration: number;
  chapters: Chapter[];
  rate: number;
  rateError: string | null;
};

const IDLE: State = {
  uuid: null,
  loadedFileId: null,
  ready: false,
  failed: false,
  buffering: false,
  playing: false,
  elapsed: 0,
  duration: 0,
  chapters: [],
  rate: 1,
  rateError: null,
};

export type Playback = State & {
  book: BookState;
  volume: number;
  /** Lives here, not in a page, so a countdown keeps going when the listener leaves `/listen`. */
  sleep: SleepState;
  /** Boots a book unless it is the one already loaded; a bare relink (no file) keeps the current file. */
  open(uuid: BookUuid, fileId: number | null): void;
  /** Stops the element, cancels an armed sleep timer and forgets the book, so the dock goes. */
  close(): void;
  /** Reports the open listening stretch and the position, for a caller about to end the session. */
  flush(): Promise<void>;
  toggle(): void;
  skip(delta: number): void;
  seek(seconds: number): void;
  /** Applies a speed (already in range) to the element, this device's copy and the server. */
  setRate(rate: number): void;
  setVolume(volume: number): void;
  /** A preset in seconds; 0 turns the timer off. */
  sleepFor(seconds: number): void;
  sleepAtChapterEnd(): void;
  toggleFade(): void;
};

const PlaybackContext = createContext<Playback | null>(null);

/** The app-wide player: one `<audio>` and the book it plays. */
export function usePlayback(): Playback {
  const playback = useContext(PlaybackContext);
  if (!playback)
    throw new Error("usePlayback rendered outside PlaybackProvider");
  return playback;
}

type Engine = ReturnType<typeof createEngine>;

type Boot = {
  uuid: BookUuid;
  fileId: number | null;
  userId: number | null;
  engine: Engine;
  /** False once another book (or a teardown) took over: a stale boot writes nothing. */
  isCurrent(): boolean;
  /** Where the book plays on when this file ends; set once the manifest says. */
  nextFile: { current: number | null };
  /** True once the listener picked a speed during this boot. */
  rateSet: { current: boolean };
  patch(change: Partial<State>): void;
  startSaver(saveFileId: number | null): void;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The book query's answer in the shape the screens read. */
function bookStateOf(
  uuid: BookUuid | null,
  result: UseQueryResult<BookDetail | null>,
): BookState {
  if (!uuid) return { status: "idle" };
  if (result.data) return { status: "ready", book: result.data };
  if (result.data === null) return { status: "missing" };
  if (result.isError) {
    return { status: "error", message: messageOf(result.error) };
  }
  return { status: "pending" };
}

/** Takes the server's speed (seeding it from this device's when it has none) and applies it. */
async function reconcileRate({
  uuid,
  userId,
  engine,
  isCurrent,
  rateSet,
  patch,
}: Boot) {
  const server = await fetchPlaybackRate(uuid).catch(() => "failed" as const);
  if (!isCurrent()) return false;
  // The listener's pick during the wait beats the late answer.
  if (rateSet.current) return true;
  if (userId !== null && typeof server === "number") {
    saveLocalRate(userId, uuid, server);
  }
  const { rate, seed } = resolveRate(
    server,
    userId === null ? null : loadLocalRate(userId, uuid),
  );
  patch({ rate });
  engine.setRate(rate);
  if (seed) {
    await savePlaybackRate(uuid, rate).catch((error) => {
      if (isCurrent()) {
        patch({
          rateError: `Could not save playback speed: ${messageOf(error)}`,
        });
      }
    });
  }
  return isCurrent();
}

/** Waits for the transcode, then hands the stream to hls.js. */
async function bootHls(
  { uuid, engine, isCurrent, patch }: Boot,
  url: string,
  resumeAt: number | null,
) {
  for (;;) {
    const state = await fetchTranscodeState(uuid);
    if (!isCurrent()) return;
    if (state === "failed") return patch({ failed: true });
    if (state === "ready") {
      // Without hls.js the engine can still hand the stream to a native player.
      const Hls = await loadHls().catch(() => undefined);
      if (isCurrent() && !engine.initHls(url, resumeAt, Hls)) {
        patch({ failed: true });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Resolves where to start from the server and this device, then loads the book's audio. */
async function runBoot(boot: Boot) {
  const { uuid, fileId, isCurrent, patch, engine } = boot;
  // A failed read is not "no position": booting from 0 would overwrite the saved one on first play.
  const row = await fetchListeningRow(uuid).catch(() => "failed" as const);
  if (!isCurrent()) return;
  if (row === "failed") return patch({ failed: true });
  if (!(await reconcileRate(boot))) return;
  const resume = await fetchListeningResume(uuid);
  if (!isCurrent()) return;
  const follow = resolveFollowBoot(fileId, resume);
  const bootFile = follow?.fileId ?? fileId ?? row?.fileId ?? null;
  let manifest = await fetchAudioManifest(uuid, bootFile);
  // A saved file is a soft reference (a reindex may have replaced it); an explicit pick isn't.
  if (!manifest && fileId === null && bootFile !== null) {
    manifest = await fetchAudioManifest(uuid, null);
  }
  if (!isCurrent()) return;
  if (!manifest) return patch({ failed: true });

  boot.startSaver(manifest.fileId);
  const resumeAt = bootResumePosition(
    follow,
    row,
    loadLocalPosition(uuid),
    manifest.fileId,
    manifest.fileCount,
  );
  // Painted before the element seeks to it; the engine gates it from being saved.
  patch({
    loadedFileId: manifest.fileId,
    ...(resumeAt === null ? {} : { elapsed: resumeAt }),
  });
  if (manifest.mode === "hls") {
    return bootHls(boot, manifest.playlistUrl, resumeAt);
  }
  if (manifest.parts.length === 0) return patch({ failed: true });
  boot.nextFile.current = manifest.nextFileId;
  patch({ chapters: manifest.chapters });
  engine.initDirect(manifest.parts, resumeAt);
}

/** Owns the page's one `<audio>`, so playback survives a route change; sign-out unmounts it and stops the sound. */
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const userId = useQuery(meQuery).data?.id ?? null;
  const client = useQueryClient();
  const [state, setState] = useState(IDLE);
  const [tracker] = useState(() => new SessionTracker("audio"));
  const [volume, setVolumeState] = useState(loadVolume);
  const [sleep, setSleep] = useState(SLEEP_OFF);
  const engineRef = useRef<Engine | null>(null);
  const timerRef = useRef<SleepTimer | null>(null);
  // What the engine's events saw last: they outlive the render that attached them.
  const live = useRef(state);
  useEffect(() => {
    live.current = state;
  });
  const saverRef = useRef<ReturnType<typeof createPositionSaver> | null>(null);
  const loadedRef = useRef<{ uuid: BookUuid; fileId: number | null } | null>(
    null,
  );
  const bootRef = useRef(0);
  const nextFileRef = useRef<number | null>(null);
  // The first `play` of a boot marks the book reading; `play` also fires on every resume.
  const markedReading = useRef(false);
  const rateSetRef = useRef(false);
  const openRef = useRef<Playback["open"] | null>(null);
  const volumeRef = useRef(volume);

  const { uuid, playing } = state;
  const bookResult = useQuery(
    uuid ? bookQuery(uuid) : { queryKey: ["book"], queryFn: skipToken },
  );
  const book = bookStateOf(uuid, bookResult);

  const patch = useCallback((change: Partial<State>) => {
    setState((prev) =>
      Object.entries(change).every(([k, v]) =>
        Object.is(prev[k as keyof State], v),
      )
        ? prev
        : { ...prev, ...change },
    );
  }, []);

  // The read status may have moved; only it and the smart shelves read it (not the edit form's query).
  const markRead = useCallback(
    (uuid: BookUuid, atEnd: boolean) =>
      void applyAutoReadStatus(uuid, atEnd).then(() => {
        for (const { queryKey } of [
          readStatusQuery(uuid),
          shelvesQuery(uuid),
        ]) {
          void client.invalidateQueries({ queryKey });
        }
      }),
    [client],
  );

  // The engine lives and dies with the element.
  const attach = useCallback(
    (audio: HTMLAudioElement) => {
      const events: EngineEvents = {
        time(t, userActed) {
          patch({ elapsed: t });
          saverRef.current?.time(t, userActed);
        },
        seeked(t) {
          patch({ elapsed: t });
          saverRef.current?.seeked(t);
          timerRef.current?.seeked(live.current.chapters, t, live.current.rate);
        },
        duration: (duration) => patch({ duration }),
        play() {
          patch({ playing: true });
          const uuid = live.current.uuid;
          if (!uuid || markedReading.current) return;
          markedReading.current = true;
          markRead(uuid, false);
        },
        pause(t, userActed) {
          patch({ playing: false });
          void saverRef.current?.pause(t, userActed);
        },
        ended() {
          const uuid = live.current.uuid;
          if (!uuid) return;
          // A file of a sequence played through: the next one waits paused; only the last finishes the book.
          if (nextFileRef.current !== null) {
            openRef.current?.(uuid, nextFileRef.current);
          } else {
            markRead(uuid, true);
          }
        },
        booted: () => patch({ ready: true }),
        buffering: (buffering) => patch({ buffering }),
        stalled: () => patch({ failed: true }),
      };
      const engine = createEngine(audio, events);
      engine.setVolume(volumeRef.current);
      engineRef.current = engine;
      timerRef.current = createSleepTimer(
        {
          pause: engine.pause,
          setVolume: engine.setVolume,
          targetVolume: () => volumeRef.current,
        },
        setSleep,
      );
      return () => {
        bootRef.current++;
        engine.dispose();
        engineRef.current = null;
        timerRef.current = null;
        loadedRef.current = null;
      };
    },
    [patch, markRead],
  );

  const open = useCallback(
    (uuid: BookUuid, fileId: number | null) => {
      const engine = engineRef.current;
      if (!engine || !needsReload(loadedRef.current, uuid, fileId)) return;
      const sameBook = loadedRef.current?.uuid === uuid;
      loadedRef.current = { uuid, fileId };
      const token = ++bootRef.current;
      const isCurrent = () => bootRef.current === token;
      engine.stop();
      // The timer outlives a page, and a file of the same book, but not another book.
      if (sameBook) timerRef.current?.fileChanged();
      else timerRef.current?.off();
      saverRef.current = null;
      nextFileRef.current = null;
      markedReading.current = false;
      rateSetRef.current = false;
      setState({
        ...IDLE,
        uuid,
        rate: userId === null ? 1 : (loadLocalRate(userId, uuid) ?? 1),
      });
      void runBoot({
        uuid,
        fileId,
        userId,
        engine,
        isCurrent,
        nextFile: nextFileRef,
        rateSet: rateSetRef,
        patch,
        startSaver: (saveFileId) => {
          // The file the manifest resolved is the one loaded, so a link naming it needs no reboot.
          loadedRef.current = { uuid, fileId: saveFileId ?? fileId };
          saverRef.current = createPositionSaver((seconds) => {
            saveLocalPosition(uuid, seconds);
            return saveListeningPosition(uuid, saveFileId, seconds);
          });
        },
      });
    },
    [userId, patch],
  );

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const close = useCallback(() => {
    bootRef.current++;
    engineRef.current?.stop();
    timerRef.current?.off();
    saverRef.current = null;
    loadedRef.current = null;
    setState(IDLE);
  }, []);

  const setVolume = useCallback((next: number) => {
    const v = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
    volumeRef.current = v;
    setVolumeState(v);
    saveVolume(v);
    engineRef.current?.setVolume(v);
  }, []);

  const setRate = useCallback(
    (rate: number) => {
      const uuid = loadedRef.current?.uuid;
      if (!uuid) return;
      const token = bootRef.current;
      rateSetRef.current = true;
      patch({ rate });
      engineRef.current?.setRate(rate);
      if (userId !== null) saveLocalRate(userId, uuid, rate);
      // A save that lands after a book swap says nothing about the new book.
      savePlaybackRate(uuid, rate).then(
        () => bootRef.current === token && patch({ rateError: null }),
        (error) =>
          bootRef.current === token &&
          patch({
            rateError: `Could not save playback speed: ${messageOf(error)}`,
          }),
      );
    },
    [userId, patch],
  );

  // The playhead and the speed are what an end-of-chapter timer reads its boundary and readout from.
  useEffect(() => {
    timerRef.current?.position(state.elapsed, state.rate);
  }, [state.elapsed, state.rate]);
  // One session per stretch of a book playing: reported on pause, a book swap, every minute and at pagehide.
  useEffect(() => {
    if (!uuid || !playing) return;
    const send = (session: SessionReport | null) => {
      if (session) void postSessions([session]);
    };
    tracker.start(uuid, nowSecs());
    const flush = () => send(tracker.stop(nowSecs()));
    const beat = setInterval(() => send(tracker.rollover(nowSecs())), 60_000);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [uuid, playing, tracker]);

  const flush = useCallback(async () => {
    const at = engineRef.current?.where();
    // Rolled over, not stopped: a refused logout leaves the player playing.
    const session = tracker.rollover(nowSecs());
    await Promise.all([
      at && saverRef.current?.pause(at.seconds, at.userActed),
      session && postSessions([session]),
    ]);
  }, [tracker]);

  const armed = sleep.remaining !== null;
  useEffect(() => {
    if (!armed) return;
    const id = setInterval(() => timerRef.current?.tick(), 1000);
    return () => clearInterval(id);
  }, [armed]);

  const playback: Playback = {
    ...state,
    volume,
    sleep,
    book,
    open,
    close,
    flush,
    toggle: () => engineRef.current?.toggle(),
    skip: (delta) => engineRef.current?.skip(delta),
    seek: (seconds) => engineRef.current?.seek(seconds),
    setRate,
    setVolume,
    sleepFor: (seconds) => timerRef.current?.sleepFor(seconds),
    sleepAtChapterEnd: () =>
      timerRef.current?.endOfChapter(state.chapters, state.elapsed, state.rate),
    toggleFade: () => timerRef.current?.toggleFade(),
  };
  return (
    <PlaybackContext value={playback}>
      {children}
      {/* biome-ignore lint/a11y/useMediaCaption: hidden, and an audiobook's narration has no captions to give */}
      <audio
        ref={attach}
        id="omnibus-audio"
        data-testid="listen-audio"
        preload="auto"
        style={{ display: "none" }}
      />
    </PlaybackContext>
  );
}
