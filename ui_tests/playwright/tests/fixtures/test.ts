// Extended `test` / `expect` for the omnibus Playwright suite.
//
// Overrides the default `request` fixture so the undici-backed
// `APIRequestContext` rides bearer auth on protected `/api/*` routes.
// Browsers (`page` fixture) keep cookie auth via storageState. This split
// matches production: web uses Secure cookies, mobile/CLI uses bearer —
// Playwright's undici client is in the mobile/CLI bucket since it doesn't
// honor Chromium's `http://localhost` secure-context exception for Secure
// cookies. The bearer is provisioned by globalSetup.

import { existsSync, readFileSync } from "node:fs";
import {
  type APIRequest,
  type APIRequestContext,
  test as base,
  expect,
} from "@playwright/test";

import { BEARER_TOKEN_PATH } from "../../globalSetup";

/** The connection settings an API context copies from the project. */
export type ApiContextOptions = {
  baseURL?: string;
  extraHTTPHeaders?: Record<string, string>;
};

/** The suite admin's bearer token, or null before globalSetup mints it. */
export function loadAdminBearerToken(): string | null {
  if (!existsSync(BEARER_TOKEN_PATH)) return null;
  const token = readFileSync(BEARER_TOKEN_PATH, "utf8").trim();
  return token.length > 0 ? token : null;
}

/** An API context that sends `token` as bearer auth, or no auth when null. */
export function newBearerContext(
  api: APIRequest,
  { baseURL, extraHTTPHeaders }: ApiContextOptions,
  token: string | null,
): Promise<APIRequestContext> {
  return api.newContext({
    baseURL,
    extraHTTPHeaders: {
      ...extraHTTPHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export const test = base.extend({
  request: async ({ playwright, baseURL, extraHTTPHeaders }, use) => {
    const ctx = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      loadAdminBearerToken(),
    );
    await use(ctx);
    await ctx.dispose();
  },
});
export { expect };
