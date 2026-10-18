import type { BrowserContext } from "@playwright/test";

/** The part of `POST /api/rpc/kobo/devices/create`'s answer a test keeps. */
export type CreatedKoboDevice = { id: number };

/** What a stubbed device list needs of each Kobo device. */
export type KoboDeviceListing = { id: number; name: string };

/** The part of `POST /api/rpc/api-tokens/create`'s answer a test keeps. */
export type CreatedApiToken = { token: { id: number } };

type SessionCookie = Parameters<BrowserContext["addCookies"]>[0][number];

/** A signed-in user and the cookies of their session. */
export type SignedInSession = {
  user: { id: number };
  cookies: SessionCookie[];
};
