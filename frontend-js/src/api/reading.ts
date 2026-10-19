import { nowSecs } from "../format";
import { toBook } from "./books";
import type { BookUuid, UserId } from "./core";
import { fetchJson, ok, send } from "./core";
import {
  getAlignment,
  getBookmarks,
  getCrossFormatResume,
  getDeleteBookmarkUrl,
  getDeleteHighlightUrl,
  getDeleteRatingUrl,
  getGetBookInsightsUrl,
  getGetProgressUrl,
  getGetRatingUrl,
  getGetReadStatusUrl,
  getHighlights,
  getOtherRatings,
  getPatchHighlightColorUrl,
  getPatchHighlightNoteUrl,
  getPostCrossFormatFollowUrl,
  getPostSyncPointUrl,
  getRecentProgress,
  getSessionLog,
  postBookmark,
  postHighlight,
  postProgress,
  postRating,
  putReadStatus,
  postSessions as sendSessions,
} from "./generated/omnibus";
import type {
  AlignmentViewOutput,
  BookInsights as BookInsightsWire,
  Bookmark as BookmarkWire,
  BookProgress as BookProgressWire,
  CrossFormatResumeOutput as CrossFormatResume,
  Highlight as HighlightWire,
  AttributedRating as OtherRatingWire,
  ProgressRecord as PositionWire,
  RatingRecord as RatingWire,
  ReadStatus as ReadState,
  ReadStatusRecord as ReadStatusWire,
  ResumePoint as ResumePointWire,
  SessionLogPageOutput,
  SessionReport as SessionReportWire,
} from "./generated/schemas";
import {
  BookInsights as BookInsightsSchema,
  BookProgress as BookProgressSchema,
  RatingRecord as RatingRecordSchema,
  ReadStatusRecord as ReadStatusRecordSchema,
} from "./generated/schemas";

/** The screen's shape of one `GET /api/progress/recent` entry. */
export function toResumePoint({
  record,
  book,
  linked,
  playback_rate,
  audio_part,
}: ResumePointWire) {
  return {
    // The progress row's own uuid, not the resolved book's: merged books share one.
    key: `${record.book_uuid}:${record.format}`,
    book: toBook(book),
    format: record.format,
    fileId: record.book_file_id ?? null,
    formats: book.formats ?? [],
    percent: record.progress_percent ?? null,
    positionSeconds: record.audio_position_seconds ?? null,
    totalSeconds: record.total_duration_seconds ?? null,
    playbackRate: playback_rate ?? null,
    linked: linked ?? false,
    // A low-confidence block measured the container's marks, which read as a part.
    chapter:
      record.resolved?.confidence === "high"
        ? (record.resolved.chapter_ordinal ?? null)
        : null,
    part: audio_part ?? null,
  };
}

export type ResumePoint = ReturnType<typeof toResumePoint>;

/** The reader's most recent reading and listening positions, newest first. */
export async function fetchRecentProgress(
  limit: number,
): Promise<ResumePoint[]> {
  return ok(await getRecentProgress({ limit })).map(toResumePoint);
}

/** Where the reader stands in one format: a CFI or a percent, or seconds into the audio. */
function toPosition(wire: PositionWire) {
  return {
    cfi: wire.epub_cfi ?? null,
    percent: wire.progress_percent ?? null,
    // A CFI the server placed for a percent-only row, such as a Kobo's.
    derivedCfi: wire.derived_epub_cfi ?? null,
    audioSeconds: wire.audio_position_seconds ?? null,
    updatedAt: wire.client_updated_at,
  };
}

/** The screen's shape of `GET /api/progress/{uuid}`: a position per format, `null` if never opened. */
export function toProgress(wire: BookProgressWire | null) {
  const at = (format: PositionWire["format"]) => {
    const record = wire?.records.find((r) => r.format === format);
    return record ? toPosition(record) : null;
  };
  return { reading: at("epub"), listening: at("audio") };
}

export type Progress = ReturnType<typeof toProgress>;
export type Position = NonNullable<Progress["reading"]>;

/** The reader's saved positions in a book, one per format. */
export async function fetchProgress(uuid: BookUuid): Promise<Progress> {
  const data = await fetchJson(
    getGetProgressUrl(encodeURIComponent(uuid)),
    BookProgressSchema.nullable(),
  );
  return toProgress(data);
}

/** Saves where the reader stands: an anchor (`comic-page:N`, `pdf-page:N`, a CFI) and the whole-book percent. */
export async function saveReadingPosition(
  uuid: BookUuid,
  position: { anchor: string; percent: number },
): Promise<void> {
  ok(
    await postProgress({
      book_uuid: uuid,
      format: "epub",
      epub_cfi: position.anchor,
      progress_percent: position.percent,
      client_updated_at: nowSecs(),
    }),
  );
}

export type SessionReport = SessionReportWire;

/** Reports reading sittings, best-effort: `keepalive` lets an unload flush finish, and a lost batch costs one heartbeat of stats. */
export async function postSessions(reports: SessionReport[]): Promise<void> {
  if (reports.length === 0) return;
  await sendSessions(reports, { keepalive: true }).catch(() => {});
}

/** The screen's shape of `GET /api/books/{uuid}/alignment`. */
export function toAlignment(wire: AlignmentViewOutput) {
  return {
    chapters:
      wire.ebook?.chapters.map((c) => ({
        title: c.title,
        percent: c.percent,
        spineIndex: c.spine_index ?? 0,
        anchorPath: c.anchor_path ?? null,
      })) ?? null,
    audioFiles: wire.audio_files.map((f) => ({
      id: f.book_file_id,
      seconds: f.duration_seconds,
    })),
    anchorPairs: wire.anchor_pairs ?? [],
    reading: wire.reading ? { percent: wire.reading.percent ?? null } : null,
    listening: wire.listening
      ? {
          fileId: wire.listening.book_file_id ?? null,
          seconds: wire.listening.seconds,
        }
      : null,
    link: wire.link
      ? {
          stale: wire.link.stale,
          follow: wire.link.follow ?? false,
          confirmedAt: wire.link.confirmed_at,
        }
      : null,
  };
}

export type Alignment = ReturnType<typeof toAlignment>;

/** How the ebook and audiobook line up: chapters, audio files, link and both positions. */
export async function fetchAlignment(uuid: BookUuid): Promise<Alignment> {
  return toAlignment(ok(await getAlignment(encodeURIComponent(uuid))));
}

export type ReadStatusValue = ReadState;

function toReadStatus(wire: ReadStatusWire) {
  return { status: wire.status, finishedAt: wire.finished_at ?? null };
}

export type ReadStatusRecord = ReturnType<typeof toReadStatus>;

/** The reader's read status for a book, or `null` when they never set one. */
export async function fetchReadStatus(
  uuid: BookUuid,
): Promise<ReadStatusRecord | null> {
  const data = await fetchJson(
    getGetReadStatusUrl(encodeURIComponent(uuid)),
    ReadStatusRecordSchema.nullable(),
  );
  return data && toReadStatus(data);
}

export async function saveReadStatus(
  uuid: BookUuid,
  status: ReadStatusValue,
): Promise<ReadStatusRecord> {
  return toReadStatus(ok(await putReadStatus({ book_uuid: uuid, status })));
}

/** Turns follow mode on or off for a linked book. */
export async function setFollow(
  uuid: BookUuid,
  enabled: boolean,
): Promise<void> {
  await send(getPostCrossFormatFollowUrl(encodeURIComponent(uuid)), "POST", {
    enabled,
  });
}

function toRating(wire: RatingWire) {
  return { stars: wire.stars, updatedAt: wire.updated_at };
}

export type RatingRecord = ReturnType<typeof toRating>;

/** The reader's star rating for a book, or `null` when they never gave one. */
export async function fetchRating(
  uuid: BookUuid,
): Promise<RatingRecord | null> {
  const data = await fetchJson(
    getGetRatingUrl(encodeURIComponent(uuid)),
    RatingRecordSchema.nullable(),
  );
  return data && toRating(data);
}

/** Sets the reader's rating, 0.5 to 5 in half steps. */
export async function saveRating(
  uuid: BookUuid,
  stars: number,
): Promise<RatingRecord> {
  return toRating(ok(await postRating({ book_uuid: uuid, stars })));
}

export async function clearRating(uuid: BookUuid): Promise<void> {
  await send(getDeleteRatingUrl(encodeURIComponent(uuid)), "DELETE");
}

function toOtherRating(wire: OtherRatingWire) {
  return {
    reader: {
      id: wire.user_id as UserId,
      name: wire.username,
      hasAvatar: wire.has_avatar ?? false,
    },
    stars: wire.stars,
    updatedAt: wire.updated_at,
  };
}

export type OtherRating = ReturnType<typeof toOtherRating>;

/** What other readers on this server rated the book. */
export async function fetchOtherRatings(
  uuid: BookUuid,
): Promise<OtherRating[]> {
  return ok(await getOtherRatings(encodeURIComponent(uuid))).map(toOtherRating);
}

function toSessionLogPage(wire: SessionLogPageOutput) {
  return {
    sittings: wire.entries.map((e) => ({
      bookUuid: e.book_uuid,
      startedAt: e.started_at,
      seconds: e.seconds,
      format: e.format,
    })),
    next: wire.next_before ?? null,
  };
}

export type SessionLogPage = ReturnType<typeof toSessionLogPage>;

/** One page of the reader's sittings in a book, newest first; pass `""` for the first page. */
export async function fetchSessionLog(
  uuid: BookUuid,
  before: string,
): Promise<SessionLogPage> {
  return toSessionLogPage(
    ok(
      await getSessionLog({
        book: uuid,
        ...(before ? { before } : {}),
      }),
    ),
  );
}

function toHighlight(wire: HighlightWire) {
  return {
    id: wire.id,
    bookUuid: wire.book_uuid,
    color: wire.color,
    text: wire.text ?? null,
    note: wire.note ?? null,
    anchor: wire.epub_cfi_range ?? null,
    createdAt: wire.created_at,
  };
}

export type Highlight = ReturnType<typeof toHighlight>;
export type HighlightColor = HighlightWire["color"];

/** The reader's saved passages in a book. */
export async function fetchHighlights(uuid: BookUuid): Promise<Highlight[]> {
  return ok(await getHighlights(encodeURIComponent(uuid))).map(toHighlight);
}

/** Saves a passage the reader marked; `anchor` is an EPUB range CFI or a PDF `pdf:` anchor. */
export async function createHighlight(
  uuid: BookUuid,
  passage: { anchor: string; color: HighlightColor; text: string },
): Promise<Highlight> {
  return toHighlight(
    ok(
      await postHighlight({
        book_uuid: uuid,
        epub_cfi_range: passage.anchor,
        color: passage.color,
        text: passage.text === "" ? null : passage.text,
      }),
    ),
  );
}

export async function recolorHighlight(
  id: number,
  color: HighlightColor,
): Promise<void> {
  await send(getPatchHighlightColorUrl(String(id)), "PATCH", { color });
}

/** Puts `note` on a passage; `null` removes the note. */
export async function saveHighlightNote(
  id: number,
  note: string | null,
): Promise<void> {
  await send(getPatchHighlightNoteUrl(String(id)), "PATCH", { note });
}

export async function deleteHighlight(id: number): Promise<void> {
  await send(getDeleteHighlightUrl(String(id)), "DELETE");
}

function toBookmark(wire: BookmarkWire) {
  return {
    id: wire.id,
    position: wire.position,
    title: wire.title ?? null,
    createdAt: wire.created_at,
  };
}

export type Bookmark = ReturnType<typeof toBookmark>;

/** The reader's saved places in a book. */
export async function fetchBookmarks(uuid: BookUuid): Promise<Bookmark[]> {
  return ok(await getBookmarks(encodeURIComponent(uuid))).map(toBookmark);
}

/** Saves a place; `position` is an EPUB CFI or a PDF `pdf-page:N` anchor. */
export async function createBookmark(
  uuid: BookUuid,
  bookmark: { position: string; title: string | null },
): Promise<Bookmark> {
  return toBookmark(ok(await postBookmark({ book_uuid: uuid, ...bookmark })));
}

export async function deleteBookmark(id: number): Promise<void> {
  await send(getDeleteBookmarkUrl(String(id)), "DELETE");
}

export type { CrossFormatResume };

/** Where the other format has the reader, mapped onto the ebook; `null` when the route has no answer. */
export async function fetchCrossFormatResume(
  uuid: BookUuid,
): Promise<CrossFormatResume | null> {
  const res = await getCrossFormatResume(encodeURIComponent(uuid), {
    target: "epub",
    derive: "cfi",
  }).catch(() => null);
  return res?.status === 200 ? res.data : null;
}

/** Declares the spot the reader is at as matching their place in the other format. A 409 means the formats aren't linked. */
export async function declareSyncPoint(
  uuid: BookUuid,
  at: { fraction: number; cfi: string | null },
): Promise<void> {
  await send(getPostSyncPointUrl(encodeURIComponent(uuid)), "POST", {
    book_uuid: uuid,
    format: "epub",
    ebook_fraction: Math.min(Math.max(at.fraction, 0), 1),
    epub_cfi: at.cfi,
  });
}

function toInsights(wire: BookInsightsWire) {
  return {
    startedAt: wire.started_at,
    secondsTotal: wire.seconds_total,
    sessions: wire.sessions,
    sittingSeconds: wire.sitting_seconds ?? 0,
    longestSeconds: wire.longest_seconds,
    longestStartedAt: wire.longest_started_at,
    daily: wire.daily,
    asOfDay: wire.as_of_day,
  };
}

export type Insights = ReturnType<typeof toInsights>;

/** The reader's time in a book: when they started, how long, how often; `null` before a sitting of a minute. */
export async function fetchInsights(uuid: BookUuid): Promise<Insights | null> {
  // East-positive minutes, which is where the server cuts each day.
  const url = getGetBookInsightsUrl(encodeURIComponent(uuid), {
    utc_offset_minutes: -new Date().getTimezoneOffset(),
  });
  const data = await fetchJson(url, BookInsightsSchema.nullable());
  return data && toInsights(data);
}
