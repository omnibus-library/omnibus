import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { expectMutation } from "./api";
import { gotoReady } from "./nav";

const READER_PERMISSIONS = {
  is_admin: false,
  can_upload: false,
  can_edit: false,
  can_download: true,
};

/** Create a non-admin reader through the admin API; 409 means it already exists. */
export async function provisionUser(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<void> {
  const resp = await request.post("/api/admin/users", {
    data: { username, password, permissions: READER_PERMISSIONS },
  });
  expect([201, 409]).toContain(resp.status());
}

/**
 * Create a non-admin reader through the admin API and return its id, for a
 * spec that deletes the reader (`DELETE /api/admin/users/{id}`) when it is done.
 */
export async function createReader(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<number> {
  const resp = await request.post("/api/admin/users", {
    data: { username, password, permissions: READER_PERMISSIONS },
  });
  expect(resp.status(), `POST /api/admin/users failed for ${username}`).toBe(
    201,
  );
  return ((await resp.json()) as { id: number }).id;
}

/** Log `username` in through the login form and land on the library. */
export async function logInThroughUi(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await gotoReady(page, "/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await expectMutation(
    page,
    { method: "POST", url: "/api/auth/login", expectedStatus: 200 },
    async () => page.getByRole("button", { name: "Log in" }).click(),
  );
  await expect(page).toHaveURL(/\/$/);
}
