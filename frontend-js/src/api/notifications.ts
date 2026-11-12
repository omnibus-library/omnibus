import { queryOptions } from "@tanstack/react-query";
import { failure, ok, send } from "./core";
import {
  createNotificationConnection,
  getDeleteNotificationConnectionUrl,
  getPublicUrl,
  getTestNotificationConnectionUrl,
  getUpdateNotificationConnectionUrl,
  listNotificationConnections,
  postPublicUrl,
  updateNotificationConnection,
} from "./generated/omnibus";
import type {
  NotificationConnectionInput,
  NotificationConnectionOutput,
  NotificationConnectionsOutput,
  NotificationTest,
  PublicUrlStatusOutput,
} from "./generated/schemas";
import {
  NotificationConnection as NotificationConnectionSchema,
  NotificationEvent,
  NtfyAuth,
} from "./generated/schemas";

export type {
  ConnectionSettingsInput,
  NotificationConnectionInput,
  NotificationLastDeliveryOutput as NotificationLastDelivery,
  NotificationTest,
} from "./generated/schemas";
export { NotificationEvent, NtfyAuth };

/** A saved connection as the server lists it: secrets only say whether one is set. */
export type NotificationConnection = NotificationConnectionOutput;

/** Every connection, and the events this server offers now. */
export type NotificationConnections = NotificationConnectionsOutput;

/** The public URL in effect and where it came from. */
export type PublicUrlStatus = PublicUrlStatusOutput;

// The Notifications section's reads and writes. Every query key starts with "admin".

/** The address the server links to from notifications, and whether it was saved here or comes from the environment. */
export const publicUrlQuery = queryOptions({
  queryKey: ["admin", "public-url"],
  queryFn: async () => ok(await getPublicUrl()),
});

/** Saves the public URL, or clears the saved one with `null`; answers what is in effect now. */
export async function savePublicUrl(
  url: string | null,
): Promise<PublicUrlStatus> {
  return ok(await postPublicUrl({ url }));
}

/** The notification connections, sorted by name, with the events the server offers. */
export const notificationConnectionsQuery = queryOptions({
  queryKey: ["admin", "notification-connections"],
  queryFn: async () => ok(await listNotificationConnections()),
});

/** Saves a new connection; answers it as the server stored it. */
export async function addNotificationConnection(
  input: NotificationConnectionInput,
): Promise<NotificationConnection> {
  const res = await createNotificationConnection(input);
  if (res.status !== 201) throw failure(res);
  return res.data;
}

/** Replaces every field of a connection; a secret left out keeps the saved one. */
export async function saveNotificationConnection(
  id: number,
  input: NotificationConnectionInput,
): Promise<NotificationConnection> {
  return ok(await updateNotificationConnection(id, input));
}

/**
 * Turns a connection on or off and nothing else, so an edit another admin saved meanwhile
 * survives; answers the connection as the server now holds it.
 */
export async function setNotificationConnectionEnabled(
  id: number,
  enabled: boolean,
): Promise<NotificationConnection> {
  // shortcut: the OpenAPI document doesn't describe this PATCH yet, so it is sent by hand; swap for the generated set_notification_connection_enabled fetcher once it does.
  const res = await send(getUpdateNotificationConnectionUrl(id), "PATCH", {
    enabled,
  });
  return NotificationConnectionSchema.parse(await res.json());
}

/** Deletes a connection and whatever was queued for it. */
export async function removeNotificationConnection(id: number) {
  await send(getDeleteNotificationConnectionUrl(id), "DELETE");
}

/** Sends a sample notification through `test`'s settings without saving them; a refusal throws the provider's answer. */
export async function sendTestNotification(test: NotificationTest) {
  await send(getTestNotificationConnectionUrl(), "POST", test);
}
