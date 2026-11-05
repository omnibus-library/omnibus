import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The library as the landing page lists it, read as whoever owns the context. */
export class EbooksRequests extends BaseRequests {
  /** The whole library unpaged, as `{ books }`. */
  getEbooks(): Promise<APIResponse> {
    return this.get("/api/ebooks");
  }

  /** What an admin can delete of a book: its files and copies. */
  getDeletionManifest(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/books/${bookUuid}/deletion-manifest`);
  }

  /** Deletes the listed files and copies; the book goes once none is left. */
  postDeleteFiles(
    bookUuid: string,
    selection: { file_ids: number[]; copy_ids: number[] },
  ): Promise<APIResponse> {
    return this.post(`/api/books/${bookUuid}/delete-files`, selection);
  }

  /** One book as the detail page reads it, with its override flags, genres and files. */
  getEbook(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/ebooks/${bookUuid}`);
  }
}
