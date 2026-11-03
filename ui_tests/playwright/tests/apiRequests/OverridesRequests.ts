import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Metadata overrides, which are library-wide state; needs an editor's context. */
export class OverridesRequests extends BaseRequests {
  postOverrides(
    uuid: string,
    overrides: Record<string, unknown>,
  ): Promise<APIResponse> {
    return this.post(`/api/ebooks/${uuid}/overrides`, overrides);
  }

  /** Drops every override on the book, its cover included. */
  deleteOverrides(uuid: string): Promise<APIResponse> {
    return this.delete(`/api/ebooks/${uuid}/overrides`);
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
