import type { APIResponse } from "@playwright/test";
import type { SessionSeed } from "../data/stats";
import { BaseRequests } from "./BaseRequests";

/** The reading history the stats page summarises, written as the context's user. */
export class StatsRequests extends BaseRequests {
  /** The answer counts the sittings recorded; unknown book uuids are skipped. */
  postSessions(sessions: SessionSeed[]): Promise<APIResponse> {
    return this.post("/api/progress/sessions", sessions);
  }

  postRating(bookUuid: string, stars: number): Promise<APIResponse> {
    return this.post("/api/ratings", { book_uuid: bookUuid, stars });
  }

  /** A journal entry at `progress` percent; 100 counts the book as finished. */
  postJournal(
    bookUuid: string,
    bodyMd: string,
    progress: number,
  ): Promise<APIResponse> {
    return this.post("/api/journals", {
      book_uuid: bookUuid,
      body_md: bodyMd,
      progress,
    });
  }
}
