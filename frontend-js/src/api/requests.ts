import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  getRequestsSettings,
  getTestDownloadClientConnectionUrl,
  getTestProwlarrConnectionUrl,
  setRequestsSettings,
} from "./generated/omnibus";
import type {
  RequestsSettingsStatus,
  RequestsSettingsUpdate,
} from "./generated/schemas";

export type {
  RequestsSettingsStatus,
  RequestsSettingsUpdate,
} from "./generated/schemas";

// The Requests section's reads and writes. Every query key starts with "admin".

/** The Prowlarr and download client connections; both secrets come back masked. */
export const requestsSettingsQuery = queryOptions({
  queryKey: ["admin", "requests"],
  queryFn: async () => ok(await getRequestsSettings()),
});

/** Replaces the connections; answers what the server now holds. */
export async function saveRequestsSettings(
  update: RequestsSettingsUpdate,
): Promise<RequestsSettingsStatus> {
  return ok(await setRequestsSettings(update));
}

/** Asks Prowlarr, through the server, whether the saved address and key work; a refusal throws its plain reason. */
export async function testProwlarr() {
  await send(getTestProwlarrConnectionUrl(), "POST");
}

/** Asks the download client, through the server, whether the saved address and login work; a refusal throws its plain reason. */
export async function testDownloadClient() {
  await send(getTestDownloadClientConnectionUrl(), "POST");
}
