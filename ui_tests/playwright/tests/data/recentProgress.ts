/** One entry of `POST /api/rpc/progress/recent`, which the user menu lists. */
export type RecentPoint = {
  record: {
    book_uuid: string;
    format: "epub" | "audio";
    epub_cfi: string | null;
    audio_position_seconds: number | null;
    book_file_id: number | null;
    updated_at: number;
    client_updated_at: number;
  };
  book: Record<string, unknown>;
  total_duration_seconds: null;
  chapter_number: null;
  chapter_count: null;
};

/** A library book with the resume point a reader would have left in it. */
export type RecentBook = { uuid: string; title: string; point: RecentPoint };

/** The point a reader leaves at `format` in `book`, shaped as the server sends it. */
export function buildRecentPoint(
  uuid: string,
  book: Record<string, unknown>,
  format: "epub" | "audio",
  bookFileId: number | null,
): RecentPoint {
  return {
    record: {
      book_uuid: uuid,
      format,
      epub_cfi: format === "epub" ? "epubcfi(/6/2)" : null,
      audio_position_seconds: format === "audio" ? 90 : null,
      // The server re-resolves this on every resume point, so it is a live id.
      book_file_id: bookFileId,
      updated_at: 123,
      // Real responses always carry this (#1362); without it the client fails
      // to deserialize the response and no resume card renders.
      client_updated_at: 123,
    },
    book,
    total_duration_seconds: null,
    chapter_number: null,
    chapter_count: null,
  };
}
