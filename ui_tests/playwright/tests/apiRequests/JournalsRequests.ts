import type { APIResponse } from "@playwright/test";
import type { JournalStatus } from "../data/journals";
import { BaseRequests } from "./BaseRequests";

/** Journal entries on a book, as whoever owns the context. */
export class JournalsRequests extends BaseRequests {
  /** Writes an entry (a `progress` of 100 finishes the book); answers it with its `id`. */
  postJournal(
    bookUuid: string,
    bodyMd: string,
    status: JournalStatus,
    progress: number | null = null,
  ): Promise<APIResponse> {
    return this.post("/api/journals", {
      book_uuid: bookUuid,
      body_md: bodyMd,
      progress,
      status,
    });
  }

  /** Answers 204; only the entry's author may delete it. */
  deleteJournal(id: number): Promise<APIResponse> {
    return this.delete(`/api/journals/${id}`);
  }
}
