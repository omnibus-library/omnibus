import type { BookUuid } from "./core";
import { fetchJson, inOrder, ok, send } from "./core";
import {
  getAudiobookManifest,
  getAudiobookStatus,
  getBookmarks,
  getCrossFormatResume,
  getGetPlaybackRateUrl,
  getGetProgressUrl,
  getPostProgressUrl,
  getPostSyncPointUrl,
  getPutBookmarkUrl,
  getPutPlaybackRateUrl,
  postBookmark,
} from "./generated/omnibus";
import type {
  AudiobookManifestOutput,
  Bookmark as BookmarkWire,
  CrossFormatResumeState,
} from "./generated/schemas";
import {
  BookProgress as BookProgressSchema,
  AudiobookPlaybackRateRecord as PlaybackRateSchema,
} from "./generated/schemas";

export type Chapter = { title: string; start: number; seconds: number };

/** One playable piece of an audio file: its URL and length in seconds. */
export type AudioPart = { url: string; seconds: number };

export type AudioManifest =
  | {
      mode: "direct";
      fileId: number | null;
      fileCount: number;
      nextFileId: number | null;
      parts: AudioPart[];
      chapters: Chapter[];
    }
  | {
      mode: "hls";
      fileId: number | null;
      fileCount: number;
      playlistUrl: string;
    };

/** The screen's shape of `GET /api/audiobooks/{uuid}/manifest`. */
export function toAudioManifest(wire: AudiobookManifestOutput): AudioManifest {
  // 0 means a server that predates the identity fields.
  const id = wire.book_file_id ?? 0;
  const fileId = id > 0 ? id : null;
  const fileCount = wire.audio_file_count ?? 0;
  if (wire.mode === "hls") {
    return { mode: "hls", fileId, fileCount, playlistUrl: wire.playlist_url };
  }
  return {
    mode: "direct",
    fileId,
    fileCount,
    nextFileId: wire.next_file_id ?? null,
    parts: wire.parts.map((p) => ({ url: p.url, seconds: p.duration_seconds })),
    chapters: (wire.chapters ?? []).map((c) => ({
      title: c.title,
      start: c.start_seconds,
      seconds: c.duration_seconds,
    })),
  };
}

/** How to play one audio file of a book, or `null` on any refusal or network error. */
export async function fetchAudioManifest(
  uuid: BookUuid,
  fileId: number | null,
): Promise<AudioManifest | null> {
  try {
    const res = await getAudiobookManifest(
      encodeURIComponent(uuid),
      fileId === null ? undefined : { file_id: fileId },
    );
    return res.status === 200 ? toAudioManifest(res.data) : null;
  } catch {
    return null;
  }
}

/** Where the HLS transcode stands; `null` when the answer is unreadable, so the caller keeps polling. */
export async function fetchTranscodeState(
  uuid: BookUuid,
): Promise<"preparing" | "ready" | "failed" | null> {
  try {
    const res = await getAudiobookStatus(encodeURIComponent(uuid));
    return res.status === 200 ? res.data.state : null;
  } catch {
    return null;
  }
}

/** The speed the reader saved for the book, or `null` when none; throws, so a failure isn't read as none. */
export async function fetchPlaybackRate(
  uuid: BookUuid,
): Promise<number | null> {
  const record = await fetchJson(
    getGetPlaybackRateUrl(encodeURIComponent(uuid)),
    PlaybackRateSchema.nullable(),
  );
  return record?.playback_rate ?? null;
}

const rateWrites = new Map<string, Promise<void>>();
// Bumped when a session ends, so a write still queued is never sent under the next account's cookie.
let generation = 0;

/** Drops every speed and position save still queued; the signed-in player calls it as it goes. */
export function dropQueuedAudioWrites() {
  generation += 1;
}

export function savePlaybackRate(uuid: BookUuid, rate: number): Promise<void> {
  const made = generation;
  // In order, so a fine-tune slider's last step is the speed the server keeps.
  return inOrder(rateWrites, uuid, async () => {
    if (made !== generation) return;
    await send(getPutPlaybackRateUrl(encodeURIComponent(uuid)), "PUT", {
      playback_rate: rate,
    });
  });
}

/** A listening position: the file it was taken in and the seconds into it. */
export type ListeningRow = { fileId: number | null; seconds: number | null };

/** The reader's saved listening position, or `null` when none; throws, so a failure isn't read as none. */
export async function fetchListeningRow(
  uuid: BookUuid,
): Promise<ListeningRow | null> {
  const progress = await fetchJson(
    getGetProgressUrl(encodeURIComponent(uuid), { format: "audio" }),
    BookProgressSchema.nullable(),
  );
  const row = progress?.records.find((r) => r.format === "audio");
  return row
    ? {
        fileId: row.book_file_id ?? null,
        seconds: row.audio_position_seconds ?? null,
      }
    : null;
}

const positionWrites = new Map<string, Promise<void>>();

/** Saves the listening position; a failed save is dropped, the next heartbeat writes it again. */
export async function saveListeningPosition(
  uuid: BookUuid,
  fileId: number | null,
  seconds: number,
): Promise<void> {
  // Left out when unknown, which is how the server tells "no file" from a file.
  const body = {
    book_uuid: uuid,
    format: "audio",
    audio_position_seconds: seconds,
    ...(fileId === null ? {} : { book_file_id: fileId }),
  };
  const made = generation;
  // In order, so a slow save never lands after a later one and rolls the position back.
  await inOrder(positionWrites, uuid, async () => {
    if (made === generation) await send(getPostProgressUrl(), "POST", body);
  }).catch(() => {});
}

/** The other format's position mapped onto this one, with whether the link follows it. */
export type ListeningResume = {
  state: CrossFormatResumeState;
  follow: boolean;
  candidate: ListeningRow | null;
};

/** The cross-format resume for the audio side, or `null` on any failure. */
export async function fetchListeningResume(
  uuid: BookUuid,
): Promise<ListeningResume | null> {
  try {
    const res = await getCrossFormatResume(encodeURIComponent(uuid), {
      target: "audio",
    });
    if (res.status !== 200) return null;
    const { state, follow, candidate } = res.data;
    return {
      state,
      follow: follow ?? false,
      candidate: candidate
        ? {
            fileId: candidate.book_file_id ?? null,
            seconds: candidate.audio_position_seconds ?? null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

/** Declares the ebook and audiobook aligned at this spot; throws an `ApiError`, 409 among them. */
export async function declareListeningSyncPoint(
  uuid: BookUuid,
  fileId: number | null,
  seconds: number,
): Promise<void> {
  await send(getPostSyncPointUrl(encodeURIComponent(uuid)), "POST", {
    book_uuid: uuid,
    format: "audio",
    audio_book_file_id: fileId,
    audio_seconds: seconds,
  });
}

export type AudioBookmark = {
  id: number;
  seconds: number;
  title: string | null;
};

function toAudioBookmark(wire: BookmarkWire): AudioBookmark {
  return {
    id: wire.id,
    seconds: Number(wire.position),
    title: wire.title ?? null,
  };
}

/** The reader's audio bookmarks; an ebook's (a CFI position) can't be played to, so they're dropped. */
export async function fetchAudioBookmarks(
  uuid: BookUuid,
): Promise<AudioBookmark[]> {
  // `Number("")` is 0, so a blank position would read as a bookmark at the start.
  return ok(await getBookmarks(encodeURIComponent(uuid)))
    .filter(
      (b) => b.position.trim() !== "" && Number.isFinite(Number(b.position)),
    )
    .map(toAudioBookmark);
}

export async function createAudioBookmark(
  uuid: BookUuid,
  seconds: number,
): Promise<AudioBookmark> {
  return toAudioBookmark(
    ok(
      await postBookmark({
        book_uuid: uuid,
        position: String(seconds),
        title: null,
      }),
    ),
  );
}

/** Names a bookmark, or clears its name with `null`. */
export async function renameBookmark(
  id: number,
  title: string | null,
): Promise<void> {
  await send(getPutBookmarkUrl(String(id)), "PUT", { title });
}
