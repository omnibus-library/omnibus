import type { APIResponse } from "@playwright/test";
import type { ExternalBookMeta } from "../data/scan";
import { BaseRequests } from "./BaseRequests";

/** The check-in flow's calls, made as whoever owns the context. */
export class ScanRequests extends BaseRequests {
  /** Looks an ISBN up the way the flow does; returns a `ScanOutcome`. */
  postResolve(isbn: string): Promise<APIResponse> {
    return this.post("/api/rpc/scan/resolve", { req: { isbn } });
  }

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

  /** Adds a new fileless book with one copy; returns `{ book_uuid }`. */
  postPhysicalOnly(book: ExternalBookMeta): Promise<APIResponse> {
    return this.post("/api/rpc/scan/physical-only", {
      req: { meta: book, note: null },
    });
  }
}
