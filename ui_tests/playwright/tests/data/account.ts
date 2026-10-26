import type { BrowserContext } from "@playwright/test";

/** A Progress sync login, shown once. */
export type KosyncLogin = { username: string; password: string };

/** The part of `POST /api/rpc/kobo/devices/create`'s answer a test keeps. */
export type CreatedKoboDevice = { id: number; kosync_login?: KosyncLogin };

/** Which kind of reader a registered device is; `kosync` is a KOReader without the plugin. */
export type DeviceKind = "kobo" | "koreader" | "kosync";

/** What a stubbed device list needs of each device; the kind defaults to a Kobo. */
export type KoboDeviceListing = { id: number; name: string; kind?: DeviceKind };

/** The part of `POST /api/rpc/api-tokens/create`'s answer a test keeps. */
export type CreatedApiToken = { token: { id: number } };

type SessionCookie = Parameters<BrowserContext["addCookies"]>[0][number];

/** A signed-in user and the cookies of their session. */
export type SignedInSession = {
  user: { id: number };
  cookies: SessionCookie[];
};
