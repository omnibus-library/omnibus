import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

test.describe("book url stability", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  // `books.id` renumbers on a reindex, so the route keys on the stable uuid.
  test("reopen a bookmarked book url after a reindex", async ({
    request,
    bookDetailPage,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book by its url", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
    });

    await test.step("reindex the library", async () => {
      await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    });

    await test.step("reopen the same url", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the same book shows", async () => {
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await expect(bookDetailPage.notFoundMessage).toHaveCount(0);
    });
  });
});
