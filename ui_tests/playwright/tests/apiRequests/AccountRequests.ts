import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The context's user's own account: switches, profile, devices and tokens. */
export class AccountRequests extends BaseRequests {
  postScrollStops(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/book-detail-scroll-stops", { enabled });
  }

  postShareStats(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/share-stats", { enabled });
  }

  postStackSeries(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/stack-series", { enabled });
  }

  /** A null name clears the display name. */
  postProfile(displayName: string | null): Promise<APIResponse> {
    return this.post("/api/account/profile", { display_name: displayName });
  }

  /** A null address clears the Kindle email. */
  postKindleEmail(email: string | null): Promise<APIResponse> {
    return this.post("/api/account/kindle-email", { email });
  }

  /** Replaces the hidden formats; an empty list shows every format again. */
  postHiddenFormats(formats: string[]): Promise<APIResponse> {
    return this.post("/api/account/hidden-formats", { formats });
  }

  postKoboDevice(name: string): Promise<APIResponse> {
    return this.post("/api/rpc/kobo/devices/create", { name });
  }

  postKoboDeviceRevoke(id: number): Promise<APIResponse> {
    return this.post("/api/rpc/kobo/devices/revoke", { id });
  }

  postApiToken(name: string): Promise<APIResponse> {
    return this.post("/api/rpc/api-tokens/create", { name });
  }

  postApiTokenRevoke(id: number): Promise<APIResponse> {
    return this.post("/api/rpc/api-tokens/revoke", { id });
  }
}
