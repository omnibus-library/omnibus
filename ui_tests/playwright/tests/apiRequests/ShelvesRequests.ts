import type { APIResponse } from "@playwright/test";
import type { NewShelf } from "../data/shelves";
import { BaseRequests } from "./BaseRequests";

/** Shelves as the context's user sees them. */
export class ShelvesRequests extends BaseRequests {
  getShelves(): Promise<APIResponse> {
    return this.get("/api/shelves");
  }

  /** Returns `{ id }` for the shelf the context's user now owns. */
  postShelf(req: NewShelf): Promise<APIResponse> {
    return this.post("/api/shelves", req);
  }

  deleteShelf(id: number): Promise<APIResponse> {
    return this.delete(`/api/shelves/${id}`);
  }
}
