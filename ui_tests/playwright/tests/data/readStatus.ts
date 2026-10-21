export type ReadStatus = "unread" | "reading" | "finished";

/** One book's read status, as `GET /api/read-status/{uuid}` reports it. */
export type ReadStatusRecord = { book_uuid: string; status: ReadStatus };
