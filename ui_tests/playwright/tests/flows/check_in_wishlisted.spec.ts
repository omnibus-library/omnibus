import type { APIRequest, APIRequestContext, Page } from "@playwright/test";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Checking in a book you wished for. Every book here is minted by the spec
// itself — a fileless wishlist entry with a title, author and ISBN nothing
// else in the suite reads — for a reader created per test on a cookie-less
// context, so neither the admin's wishlist nor any fixture is touched. Each
// test deletes what it made in a `finally`, through the admin's `request`.

const PASSWORD = "wishlisted-reader-pw-01";

/** A valid ISBN-13 no fixture carries, unique per call. */
function uniqueIsbn(): string {
  const body = `979${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`;
  const sum = [...body].reduce(
    (acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function meta(isbn: string, title: string): Record<string, unknown> {
  return {
    isbn13: isbn,
    title,
    authors: ["Wren Wishlisted"],
    year: "2021",
    pages: null,
    publisher: null,
    description: null,
    cover_url: null,
    series: null,
    first_publish_year: null,
    source: "open_library",
  };
}

/** Create a plain reader through the admin API and return its id. */
async function createReader(
  request: APIRequestContext,
  username: string,
): Promise<number> {
  const resp = await request.post("/api/admin/users", {
    data: {
      username,
      password: PASSWORD,
      permissions: {
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
      },
    },
  });
  expect(resp.status(), `POST /api/admin/users failed for ${username}`).toBe(
    201,
  );
  return ((await resp.json()) as { id: number }).id;
}

/**
 * Put a new fileless book on `username`'s wishlist over a bearer session of
 * its own, returning the book's uuid and the reader's Wishlist shelf.
 */
async function wishFor(
  api: APIRequest,
  baseURL: string,
  username: string,
  book: Record<string, unknown>,
): Promise<{ uuid: string; shelfId: number; shelfName: string }> {
  const ctx = await api.newContext({ baseURL });
  try {
    const login = await ctx.post("/api/auth/login", {
      data: { username, password: PASSWORD, client_kind: "bearer" },
    });
    expect(login.status(), `bearer login failed for ${username}`).toBe(200);
    const { token } = (await login.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    const added = await ctx.post("/api/rpc/scan/wishlist", {
      headers,
      data: { req: { book_uuid: null, meta: book, source: "manual" } },
    });
    expect(added.status(), "seed wishlist add").toBe(200);
    const { book_uuid: uuid } = (await added.json()) as { book_uuid: string };
    const me = (await (await ctx.get("/api/auth/me", { headers })).json()) as {
      id: number;
    };
    const shelves = (await (
      await ctx.get("/api/shelves", { headers })
    ).json()) as {
      id: number;
      kind: string;
      name: string;
      owner_user_id: number;
    }[];
    const shelf = shelves.find(
      (s) => s.kind === "wishlist" && s.owner_user_id === me.id,
    );
    expect(shelf, `${username} has a Wishlist`).toBeTruthy();
    return { uuid, shelfId: shelf!.id, shelfName: shelf!.name };
  } finally {
    await ctx.dispose();
  }
}

/** Sign `username` in through the login form. */
async function logIn(page: Page, username: string): Promise<void> {
  await gotoReady(page, "/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await expectMutation(
    page,
    { method: "POST", url: "/api/auth/login", expectedStatus: 200 },
    async () => page.getByRole("button", { name: "Log in" }).click(),
  );
  await expect(page).toHaveURL(/\/$/);
}

/** Delete a spec-minted fileless book (with its copies and entries). */
async function deleteBook(
  request: APIRequestContext,
  uuid: string,
): Promise<void> {
  const resp = await request
    .post("/api/rpc/physical/book/delete", { data: { uuid } })
    .catch(() => null);
  expect.soft(resp?.status(), `cleanup delete of ${uuid}`).toBe(200);
}

test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test("checks in a wishlisted book from its own page", async ({
  browser,
  request,
  playwright,
  baseURL,
}) => {
  const username = `e2e_wished_${Date.now()}`;
  const readerId = await createReader(request, username);
  const isbn = uniqueIsbn();
  const title = `E2E Wished For ${Date.now()}`;
  const { uuid, shelfId } = await wishFor(
    playwright.request,
    baseURL ?? "",
    username,
    meta(isbn, title),
  );
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await logIn(page, username);
    await gotoReady(page, `/books/${uuid}`);

    // "Check in when acquired" opens the flow with the entry's ISBN already
    // typed, rather than a blank field under a page that is showing it.
    await page.getByTestId("wishlist-check-in").click();
    await expect(page.getByTestId("check-in-overlay-scrim")).toBeVisible();
    await expect(page.getByTestId("check-in-isbn")).toHaveValue(isbn);

    // The real resolve recognises the wishlist entry and offers to file a
    // copy of it, instead of navigating to the page the reader is already on.
    await expectMutation(
      page,
      {
        method: "POST",
        url: /\/api\/rpc\/scan\/resolve$/,
        expectedStatus: 200,
      },
      async () => page.getByTestId("check-in-submit").click(),
    );
    const confirm = page.getByTestId("check-in-confirm");
    await expect(confirm).toContainText("on your wishlist");
    await expect(page.getByTestId("check-in-book")).toContainText(title);

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/scan/check-in",
        expectedBody: { req: { book_uuid: uuid, isbn, note: null } },
        expectedStatus: 200,
      },
      async () => page.getByTestId("check-in-confirm-submit").click(),
    );
    const success = page.getByTestId("check-in-success");
    await expect(success).toContainText("In your physical collection");
    await expect(success).toContainText(title);
    await expect(page.getByTestId("check-in-off-wishlist")).toContainText(
      "off your wishlist",
    );
    // Filed, and the wish fulfilled: one copy, checked in by this reader, and
    // nothing left on their Wishlist.
    const copies = (await (
      await request.get(`/api/physical/${uuid}/copies`)
    ).json()) as { added_by_name?: string }[];
    expect(copies.map((c) => c.added_by_name)).toEqual([username]);
    const shelves = (await (await request.get("/api/shelves")).json()) as {
      id: number;
      book_count: number;
    }[];
    expect(shelves.find((s) => s.id === shelfId)?.book_count).toBe(0);
  } finally {
    await context.close();
    await deleteBook(request, uuid);
    await request.delete(`/api/admin/users/${readerId}`);
  }
});
