import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The library as the landing page lists it, read as whoever owns the context. */
export class EbooksRequests extends BaseRequests {
  getEbooks(): Promise<APIResponse> {
    return this.get("/api/rpc/ebooks");
  }
}
