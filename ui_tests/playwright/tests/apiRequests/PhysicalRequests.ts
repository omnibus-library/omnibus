import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Physical copies and the fileless books they belong to. */
export class PhysicalRequests extends BaseRequests {
  getCopies(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/physical/${bookUuid}/copies`);
  }

  /** Deletes a fileless book with its copies and wishlist entries. */
  deleteBook(bookUuid: string): Promise<APIResponse> {
    return this.delete(`/api/physical/${bookUuid}`);
  }

  deleteCopy(copyId: number): Promise<APIResponse> {
    return this.delete(`/api/physical/copies/${copyId}`);
  }
}
