import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Library uploads; need an uploader's context. */
export class UploadsRequests extends BaseRequests {
  /** Files an EPUB under `<author>/<title>/`; answers 201 with `{ uuid }`. */
  postEbook(upload: {
    fileName: string;
    epub: Buffer;
    title: string;
    author: string;
  }): Promise<APIResponse> {
    return this.request.post("/api/uploads/ebooks", {
      multipart: {
        file: {
          name: upload.fileName,
          mimeType: "application/epub+zip",
          buffer: upload.epub,
        },
        title: upload.title,
        author: upload.author,
      },
    });
  }
}
