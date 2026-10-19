import { failure, send } from "./core";
import {
  getDeleteAvatarUrl,
  getPostAvatarUrl,
  getPostBookDetailScrollStopsUrl,
  getPostHiddenFormatsUrl,
  getPostProfileUrl,
  getPostShareStatsUrl,
  getPostStackSeriesUrl,
} from "./generated/omnibus";

/** Saves the name other readers see; `null` clears it, so the username shows. */
export async function setDisplayName(name: string | null): Promise<void> {
  await send(getPostProfileUrl(), "POST", { display_name: name });
}

/** Replaces the signed-in reader's picture with `file`. */
export async function uploadAvatar(file: File): Promise<void> {
  const form = new FormData();
  form.append("avatar", file);
  // Multipart sets its own Content-Type, so this skips `send`.
  const res = await fetch(getPostAvatarUrl(), { method: "POST", body: form });
  if (!res.ok) throw failure({ status: res.status, data: await res.text() });
}

/** Removes the picture, so initials show instead. */
export async function deleteAvatar(): Promise<void> {
  await send(getDeleteAvatarUrl(), "DELETE");
}

const saveSwitch = (url: string) => async (enabled: boolean) => {
  await send(url, "POST", { enabled });
};

/** Saves the reader's Stack series preference. */
export const setStackSeries = saveSwitch(getPostStackSeriesUrl());

/** Saves whether a book's page stops at each section as it scrolls. */
export const setBookDetailScrollStops = saveSwitch(
  getPostBookDetailScrollStopsUrl(),
);

/** Saves whether other readers on this server may see the reader's stats. */
export const setShareStats = saveSwitch(getPostShareStatsUrl());

/** Replaces the formats the reader's library view leaves out. */
export async function setHiddenFormats(formats: string[]): Promise<void> {
  await send(getPostHiddenFormatsUrl(), "POST", { formats });
}
