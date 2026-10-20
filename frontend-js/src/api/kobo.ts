import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { fetchJson, send } from "./core";
import {
  getCreateKoboDeviceUrl,
  getDeleteKoboDeviceUrl,
  getListKoboDevicesUrl,
  getRegenerateKoboDeviceUrl,
} from "./generated/omnibus";
import { KoboDeviceView } from "./generated/schemas";

export type { KoboDeviceView } from "./generated/schemas";

/** The reader's Kobos, each with the secret its sync address carries. */
export const koboDevicesQuery = queryOptions({
  queryKey: ["kobo-devices"],
  queryFn: () => fetchJson(getListKoboDevicesUrl(), z.array(KoboDeviceView)),
});

/** Registers a Kobo under `name`, minting its token. */
export async function createKoboDevice(name: string): Promise<KoboDeviceView> {
  const res = await send(getCreateKoboDeviceUrl(), "POST", { name });
  return KoboDeviceView.parse(await res.json());
}

/** Replaces the device's token, so its old sync address stops working. */
export async function regenerateKoboDevice(
  id: number,
): Promise<KoboDeviceView> {
  const res = await send(getRegenerateKoboDeviceUrl(id), "POST");
  return KoboDeviceView.parse(await res.json());
}

/** Removes the device, so its sync address stops working. */
export async function deleteKoboDevice(id: number): Promise<void> {
  await send(getDeleteKoboDeviceUrl(id), "DELETE");
}
