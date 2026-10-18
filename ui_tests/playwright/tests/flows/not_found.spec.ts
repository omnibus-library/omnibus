import { expect, test } from "../fixtures/pageFixtures";

// An unmatched URL once rendered dioxus-router's own parse diagnostic as the
// page: the whole internal route table, admin paths included, with no nav and
// no link back (#2214). The catch-all `Route::NotFound` replaces it.
test.describe("not-found page", () => {
  test("show the not-found layout for an unmatched path", async ({
    notFoundPage,
  }) => {
    await test.step("open an unmatched path", async () => {
      await notFoundPage.goto("/add");
    });

    await test.step("check the page names the path", async () => {
      await notFoundPage.assertDisplayed();
      await notFoundPage.topNav.assertDisplayed();
      await expect(notFoundPage.heading).toBeVisible();
      await expect(notFoundPage.root).toContainText("/add");
    });
  });

  // `/tags` was a real route long enough to be bookmarked. Only a retired
  // route catches a later `#[route("/tags")]` declared above the catch-all,
  // which an arbitrary unmatched path would still pass through.
  test("fall through to not-found from a retired route", async ({
    notFoundPage,
  }) => {
    await test.step("open the retired route", async () => {
      await notFoundPage.goto("/tags");
    });

    await test.step("check the page names the path", async () => {
      await expect(notFoundPage.root).toBeVisible();
      await expect(notFoundPage.root).toContainText("/tags");
    });
  });

  test("hide the internal route table from a mistyped url", async ({
    notFoundPage,
  }) => {
    await test.step("open a mistyped path", async () => {
      await notFoundPage.goto("/nope/deeper/still");
    });

    await test.step("check the page prints no route table", async () => {
      const body = await notFoundPage.bodyText();
      expect(body).not.toContain("Attempted Matches");
      expect(body).not.toContain("Failed to parse route");
      expect(body).not.toContain("admin/health");
    });
  });

  test("return to the library from the not-found page", async ({
    notFoundPage,
    libraryPage,
  }) => {
    await test.step("open an unmatched path", async () => {
      await notFoundPage.goto("/add");
    });

    await test.step("follow the link back", async () => {
      await notFoundPage.backToLibrary();
    });

    await test.step("check the library shows", async () => {
      await libraryPage.assertDisplayed();
      await expect(notFoundPage.root).toHaveCount(0);
    });
  });
});
