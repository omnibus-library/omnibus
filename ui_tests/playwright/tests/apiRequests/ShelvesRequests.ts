import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Shelves as the context's user sees them. */
export class ShelvesRequests extends BaseRequests {
  getShelves(): Promise<APIResponse> {
    return this.get("/api/shelves");
  }
}
