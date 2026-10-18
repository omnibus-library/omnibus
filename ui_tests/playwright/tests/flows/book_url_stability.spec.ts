import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// Book ids renumber on every reindex, so the route keys on a uuid that
// survives one. A bookmarked url must still open the same book afterwards.
test.describe("book detail url", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("keep a bookmarked book url working after a reindex", async ({
    bookDetailPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the book shows", async () => {
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
      await expect(bookDetailPage.bookNotFoundMessage).toHaveCount(0);
    });
  });
});
