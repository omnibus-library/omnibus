import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The library as the landing page lists it, read as whoever owns the context. */
export class EbooksRequests extends BaseRequests {
  getEbooks(): Promise<APIResponse> {
    return this.get("/api/rpc/ebooks");
  }

  // batch-D: one book's metadata
  /** Answers the book's metadata, or `null` once the book is gone. */
  postEbookDetail(bookUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/ebook", { uuid: bookUuid });
  }
}
