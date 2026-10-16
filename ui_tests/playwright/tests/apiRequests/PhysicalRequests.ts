import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Physical copies and the fileless books they belong to. */
export class PhysicalRequests extends BaseRequests {
  getCopies(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/physical/${bookUuid}/copies`);
  }

  /** Deletes a fileless book with its copies and wishlist entries. */
  deleteBook(bookUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/physical/book/delete", { uuid: bookUuid });
  }

  deleteCopy(copyId: number): Promise<APIResponse> {
    return this.post("/api/rpc/physical/copies/delete", { copy_id: copyId });
  }
}
