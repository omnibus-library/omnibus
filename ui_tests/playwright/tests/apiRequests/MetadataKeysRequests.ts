import type { APIResponse } from "@playwright/test";
import type { MetadataProvider } from "../data/metadataKeys";
import { BaseRequests } from "./BaseRequests";

/** The metadata providers' API keys, which are server-wide; needs an admin. */
export class MetadataKeysRequests extends BaseRequests {
  /** Saves `key`, or clears the provider's key when it is null. */
  postKey(
    provider: MetadataProvider,
    key: string | null,
  ): Promise<APIResponse> {
    return this.post(`/api/rpc/${provider}-key`, { key });
  }
}
