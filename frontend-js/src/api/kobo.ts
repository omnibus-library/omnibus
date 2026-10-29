import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { fetchJson, send } from "./core";
import {
  getCreateKoboDeviceUrl,
  getDeleteKoboDeviceUrl,
  getListKoboDevicesUrl,
  getPostKosyncUrl,
  getRegenerateKoboDeviceUrl,
} from "./generated/omnibus";
import {
  type DeviceKind,
  KoboDeviceView,
  KosyncPassword,
} from "./generated/schemas";

export type {
  DeviceKind,
  KoboDeviceView,
  KosyncPassword,
} from "./generated/schemas";

/** The reader's Kobos and KOReaders, each with the secret its sync carries. */
export const koboDevicesQuery = queryOptions({
  queryKey: ["kobo-devices"],
  queryFn: () => fetchJson(getListKoboDevicesUrl(), z.array(KoboDeviceView)),
});

/** Registers a device of `kind` under `name`, minting its token. */
export async function createKoboDevice(
  name: string,
  kind: DeviceKind,
): Promise<KoboDeviceView> {
  const res = await send(getCreateKoboDeviceUrl(), "POST", { name, kind });
  return KoboDeviceView.parse(await res.json());
}

/** Replaces the account's Progress sync password, so the old one stops working. */
export async function generateKosyncPassword(): Promise<KosyncPassword> {
  const res = await send(getPostKosyncUrl(), "POST");
  return KosyncPassword.parse(await res.json());
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
