import type { APIResponse } from "@playwright/test";
import type { JournalStatus } from "../data/journals";
import { BaseRequests } from "./BaseRequests";

/** Journal entries on a book, as whoever owns the context. */
export class JournalsRequests extends BaseRequests {
  /** Writes an entry; the body is the stored entry, with its `id`. */
  postJournal(
    bookUuid: string,
    bodyMd: string,
    status: JournalStatus,
  ): Promise<APIResponse> {
    return this.post("/api/journals", {
      book_uuid: bookUuid,
      body_md: bodyMd,
      progress: null,
      status,
    });
  }

  /** Answers 204; only the entry's author may delete it. */
  deleteJournal(id: number): Promise<APIResponse> {
    return this.delete(`/api/journals/${id}`);
  }
}
