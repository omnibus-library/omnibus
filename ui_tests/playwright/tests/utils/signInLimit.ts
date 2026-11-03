import { type APIRequestContext, expect } from "@playwright/test";

/**
 * Waits until the per-IP auth limiter (10 calls in a fixed minute) admits a
 * sign-in again, for up to 70 s. It probes with a login for a user that does
 * not exist, which answers 401 and locks no account.
 */
export async function waitForSignInRoom(
  request: APIRequestContext,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await request.post("/api/auth/login", {
            data: { username: "no-such-reader", password: "not-a-password" },
          })
        ).status(),
      {
        message: "sign-in stays rate limited",
        timeout: 70_000,
        intervals: [1_000, 5_000],
      },
    )
    .not.toBe(429);
}
