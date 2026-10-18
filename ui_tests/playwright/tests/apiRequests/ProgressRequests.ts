import type { APIResponse } from "@playwright/test";
import type { ProgressUpdate } from "../data/progress";
import { BaseRequests } from "./BaseRequests";

/** The reader's stored positions, read and written as whoever owns the context. */
export class ProgressRequests extends BaseRequests {
  /** The envelope over every format; `?format=` narrows only its records. */
  getProgress(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/progress/${bookUuid}?format=epub`);
  }

  /** Writes a position the way a Kobo does, a percent with no CFI. */
  postProgress(update: ProgressUpdate): Promise<APIResponse> {
    return this.post("/api/progress", update);
  }

  /** Saves an epub position the way the web reader does. */
  postEpubPosition(bookUuid: string, epubCfi: string): Promise<APIResponse> {
    return this.post("/api/rpc/progress", {
      update: { book_uuid: bookUuid, format: "epub", epub_cfi: epubCfi },
    });
  }

  // batch-G:
  /** Saves a position now, which puts the book on the continue-reading stack. */
  postResumePoint(bookUuid: string): Promise<APIResponse> {
    return this.post("/api/progress", {
      book_uuid: bookUuid,
      format: "epub",
      epub_cfi: "epubcfi(/6/4!/4/2/2[c01]/2/1:0)",
    });
  }

  // batch-J: audio and cross-format
  /** Saves a whole-book epub percent stamped `clientUpdatedAt`, as another device would. */
  postEpubPercent(
    bookUuid: string,
    percent: number,
    clientUpdatedAt: number,
  ): Promise<APIResponse> {
    return this.post("/api/rpc/progress", {
      update: {
        book_uuid: bookUuid,
        format: "epub",
        progress_percent: percent,
        client_updated_at: clientUpdatedAt,
      },
    });
  }

  /** Saves an audio position stamped `clientUpdatedAt`, as another device would. */
  postAudioPosition(
    bookUuid: string,
    seconds: number,
    clientUpdatedAt: number,
  ): Promise<APIResponse> {
    return this.post("/api/rpc/progress", {
      update: {
        book_uuid: bookUuid,
        format: "audio",
        audio_position_seconds: seconds,
        client_updated_at: clientUpdatedAt,
      },
    });
  }

  /** The stored record for one format, or `null` when the reader has none. */
  postProgressGet(
    bookUuid: string,
    format: "epub" | "audio",
  ): Promise<APIResponse> {
    return this.post("/api/rpc/progress/get", { uuid: bookUuid, format });
  }
}
