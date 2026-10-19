import { failure, send } from "./core";
import {
  getDeleteAvatarUrl,
  getPostAvatarUrl,
  getPostProfileUrl,
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
