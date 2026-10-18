import { type ExpectMutationOptions, post } from "../utils/api";

/** The progress endpoints the reader posts to. */
export const progressUrls = {
  save: /\/api\/rpc\/progress(?:\?|$)/,
  get: /\/api\/rpc\/progress\/get(?:\?|$)/,
  recent: /\/api\/rpc\/progress\/recent(?:\?|$)/,
};

/** The writes the reader makes to the reader's saved position. */
export const progress = {
  /** The save a page turn makes. */
  save: (): ExpectMutationOptions => post(progressUrls.save),

  /** The save a paged reader makes, with the page anchor and percent it sends. */
  savePage: (
    bookUuid: string,
    epubCfi: string,
    percent: number,
  ): ExpectMutationOptions => ({
    ...progress.save(),
    expectedBody: {
      update: {
        book_uuid: bookUuid,
        format: "epub",
        epub_cfi: epubCfi,
        progress_percent: percent,
      },
    },
  }),

  /** The save a contents jump makes, once the new chapter has rendered. */
  saveAfterJump: (): ExpectMutationOptions => ({
    ...progress.save(),
    timeout: 20_000,
  }),

  /** The read the user menu makes for its resume rows, a POST that changes nothing. */
  recent: (): ExpectMutationOptions => post(progressUrls.recent),

  /** The save the audio player makes for a position, filed under the part it plays. */
  saveAudio: (
    bookUuid: string,
    seconds: number,
    bookFileId: number,
  ): ExpectMutationOptions => ({
    ...progress.save(),
    expectedBody: {
      update: {
        book_uuid: bookUuid,
        format: "audio",
        audio_position_seconds: seconds,
        book_file_id: bookFileId,
      },
    },
  }),
};
