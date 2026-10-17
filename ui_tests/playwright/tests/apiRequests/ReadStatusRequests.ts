import type { APIResponse } from "@playwright/test";
import type { ReadStatus } from "../data/readStatus";
import { BaseRequests } from "./BaseRequests";

/** A book's read status, read and set as whoever owns the context. */
export class ReadStatusRequests extends BaseRequests {
  /** The record, or `null` when the reader has never opened the book. */
  getReadStatus(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/read-status/${bookUuid}`);
  }

  putReadStatus(bookUuid: string, status: ReadStatus): Promise<APIResponse> {
    return this.put("/api/read-status", { book_uuid: bookUuid, status });
  }
}
