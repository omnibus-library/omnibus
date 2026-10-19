import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  type BookDetail,
  type BookUuid,
  type Chapter,
  fetchAudioManifest,
  fetchBook,
  fetchListeningResume,
  fetchListeningRow,
  fetchPlaybackRate,
  fetchTranscodeState,
  saveListeningPosition,
  savePlaybackRate,
} from "../api";
import { meQuery } from "../session";
import {
  bootResumePosition,
  createPositionSaver,
  loadLocalPosition,
  loadLocalRate,
  loadVolume,
  needsReload,
  resolveBootFile,
  resolveFollowBoot,
  resolveRate,
  saveLocalPosition,
  saveLocalRate,
  saveVolume,
} from "./boot";
import { createEngine, type EngineEvents } from "./engine";
import { loadHls } from "./loadHls";

export type BookState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; book: BookDetail };

type State = {
  uuid: BookUuid | null;
  book: BookState;
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
  book: { status: "idle" },
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
  volume: number;
  /** Boots a book unless it is the one already loaded; a bare relink (no file) keeps the current file. */
  open(uuid: BookUuid, fileId: number | null): void;
  toggle(): void;
  skip(delta: number): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
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
  patch(change: Partial<State>): void;
  startSaver(saveFileId: number | null): void;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Takes the server's speed (seeding it from this device's when it has none) and applies it. */
async function reconcileRate({ uuid, userId, engine, isCurrent, patch }: Boot) {
  const server = await fetchPlaybackRate(uuid).catch(() => "failed" as const);
  if (!isCurrent()) return false;
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
      const Hls = await loadHls().catch(() => undefined);
      if (isCurrent() && !(Hls && engine.initHls(url, resumeAt, Hls))) {
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
  const row = await fetchListeningRow(uuid);
  if (!isCurrent() || !(await reconcileRate(boot))) return;
  const resume = await fetchListeningResume(uuid);
  if (!isCurrent()) return;
  const follow = resolveFollowBoot(fileId, resume);
  const bootFile =
    follow?.fileId ?? resolveBootFile(fileId, row?.fileId ?? null);
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
  patch({ chapters: manifest.chapters });
  engine.initDirect(manifest.parts, resumeAt);
}

/** Owns the page's one `<audio>`, so playback survives a route change; sign-out unmounts it and stops the sound. */
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const userId = useQuery(meQuery).data?.id ?? null;
  const [state, setState] = useState(IDLE);
  const [volume, setVolumeState] = useState(loadVolume);
  const engineRef = useRef<Engine | null>(null);
  const saverRef = useRef<ReturnType<typeof createPositionSaver> | null>(null);
  const loadedRef = useRef<{ uuid: BookUuid; fileId: number | null } | null>(
    null,
  );
  const bootRef = useRef(0);
  const volumeRef = useRef(volume);

  const patch = useCallback((change: Partial<State>) => {
    setState((prev) =>
      Object.entries(change).every(([k, v]) =>
        Object.is(prev[k as keyof State], v),
      )
        ? prev
        : { ...prev, ...change },
    );
  }, []);

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
        },
        duration: (duration) => patch({ duration }),
        play: () => patch({ playing: true }),
        pause(t, userActed) {
          patch({ playing: false });
          saverRef.current?.pause(t, userActed);
        },
        ended: () => {},
        booted: () => patch({ ready: true }),
        buffering: (buffering) => patch({ buffering }),
        stalled: () => patch({ failed: true }),
      };
      const engine = createEngine(audio, events);
      engine.setVolume(volumeRef.current);
      engineRef.current = engine;
      return () => {
        bootRef.current++;
        engine.dispose();
        engineRef.current = null;
        loadedRef.current = null;
      };
    },
    [patch],
  );

  const open = useCallback(
    (uuid: BookUuid, fileId: number | null) => {
      const engine = engineRef.current;
      if (!engine || !needsReload(loadedRef.current, uuid, fileId)) return;
      loadedRef.current = { uuid, fileId };
      const token = ++bootRef.current;
      const isCurrent = () => bootRef.current === token;
      engine.stop();
      saverRef.current = null;
      setState({
        ...IDLE,
        uuid,
        book: { status: "pending" },
        rate: userId === null ? 1 : (loadLocalRate(userId, uuid) ?? 1),
      });
      fetchBook(uuid)
        .then((book) =>
          book
            ? { status: "ready" as const, book }
            : { status: "missing" as const },
        )
        .catch((error) => ({
          status: "error" as const,
          message: messageOf(error),
        }))
        .then((book) => isCurrent() && patch({ book }));
      void runBoot({
        uuid,
        fileId,
        userId,
        engine,
        isCurrent,
        patch,
        startSaver: (saveFileId) => {
          saverRef.current = createPositionSaver((seconds) => {
            saveLocalPosition(uuid, seconds);
            void saveListeningPosition(uuid, saveFileId, seconds);
          });
        },
      });
    },
    [userId, patch],
  );

  const setVolume = useCallback((next: number) => {
    const v = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
    volumeRef.current = v;
    setVolumeState(v);
    saveVolume(v);
    engineRef.current?.setVolume(v);
  }, []);

  const playback: Playback = {
    ...state,
    volume,
    open,
    toggle: () => engineRef.current?.toggle(),
    skip: (delta) => engineRef.current?.skip(delta),
    seek: (seconds) => engineRef.current?.seek(seconds),
    setVolume,
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
