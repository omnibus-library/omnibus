import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** A book's link between its ebook and audio, as whoever owns the context. */
export class CrossFormatRequests extends BaseRequests {
  /** Confirms the link in sequence mode, which turns follow on. */
  postLink(bookUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/cross-format/link", {
      update: { book_uuid: bookUuid, mode: "sequence" },
    });
  }

  postUnlink(bookUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/cross-format/unlink", { uuid: bookUuid });
  }
}
