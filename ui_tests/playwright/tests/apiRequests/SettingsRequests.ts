import type { APIResponse } from "@playwright/test";
import type { ServerLibrary } from "../data/settings";
import { BaseRequests } from "./BaseRequests";

/** The library settings, which are server-wide; needs an admin's context. */
export class SettingsRequests extends BaseRequests {
  getSettings(): Promise<APIResponse> {
    return this.get("/api/rpc/settings");
  }

  postSettings(settings: ServerLibrary): Promise<APIResponse> {
    return this.post("/api/rpc/settings", { settings });
  }
}
