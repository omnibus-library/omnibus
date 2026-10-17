import type { APIResponse } from "@playwright/test";
import type { MetadataOverrides } from "../data/ebooks";
import { BaseRequests } from "./BaseRequests";

/** The library and a book's metadata, as whoever owns the context. */
export class EbooksRequests extends BaseRequests {
  getEbooks(): Promise<APIResponse> {
    return this.get("/api/rpc/ebooks");
  }

  getEbook(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/ebooks/${bookUuid}`);
  }

  postOverrides(
    bookUuid: string,
    overrides: MetadataOverrides,
  ): Promise<APIResponse> {
    return this.post("/api/rpc/ebook/overrides", { uuid: bookUuid, overrides });
  }

  /** Drops every override on the book, back to its scanned metadata. */
  deleteOverrides(bookUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/ebook/overrides/delete", { uuid: bookUuid });
  }
}
