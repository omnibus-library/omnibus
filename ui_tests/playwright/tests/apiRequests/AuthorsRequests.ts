import type { APIResponse } from "@playwright/test";
import { TINY_PNG } from "../data/covers";
import { BaseRequests } from "./BaseRequests";

/** An author's cached photo; both calls need an admin's context. */
export class AuthorsRequests extends BaseRequests {
  /** Uploads a photo; the server answers 204. */
  putPhoto(authorId: number): Promise<APIResponse> {
    return this.request.put(`/api/authors/${authorId}/photo`, {
      multipart: {
        photo: { name: "photo.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
  }

  /** Drops the photo, and answers 204 even when there is none. */
  deletePhoto(authorId: number): Promise<APIResponse> {
    return this.delete(`/api/authors/${authorId}/photo`);
  }
}
