import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { expectMutation } from "./api";
import { gotoReady } from "./nav";

/** Create a non-admin reader through the admin API; 409 means it already exists. */
export async function provisionUser(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<void> {
  const resp = await request.post("/api/users", {
    data: {
      username,
      password,
      permissions: {
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
      },
    },
  });
  expect([201, 409]).toContain(resp.status());
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
