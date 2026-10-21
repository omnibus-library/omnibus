import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Metadata overrides, which are library-wide state; needs an editor's context. */
export class OverridesRequests extends BaseRequests {
  postOverrides(
    uuid: string,
    overrides: Record<string, unknown>,
  ): Promise<APIResponse> {
    return this.post("/api/rpc/ebook/overrides", { uuid, overrides });
  }

  /** Drops every override on the book, its cover included. */
  deleteOverrides(uuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/ebook/overrides/delete", { uuid });
  }

  /** Uploads `png` as the book's cover override; the REST route takes multipart. */
  postCover(uuid: string, png: Buffer): Promise<APIResponse> {
    return this.request.post(`/api/ebooks/${uuid}/cover`, {
      multipart: {
        cover: { name: "cover.png", mimeType: "image/png", buffer: png },
      },
    });
  }
}
