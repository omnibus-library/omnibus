import type { APIResponse } from "@playwright/test";
import type { ExternalBookMeta } from "../data/scan";
import { BaseRequests } from "./BaseRequests";

/** The check-in flow's writes, made as whoever owns the context. */
export class ScanRequests extends BaseRequests {
  /** Wishes for a new fileless book; returns `{ book_uuid }`. */
  postWishlistEntry(book: ExternalBookMeta): Promise<APIResponse> {
    return this.post("/api/rpc/scan/wishlist", {
      req: { book_uuid: null, meta: book, source: "manual" },
    });
  }

  /** Files a physical copy of a book already in the library. */
  postCheckIn(book: { uuid: string; isbn13: string }): Promise<APIResponse> {
    return this.post("/api/rpc/scan/check-in", {
      req: { book_uuid: book.uuid, isbn: book.isbn13, note: null },
    });
  }
}
