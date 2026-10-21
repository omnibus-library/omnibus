import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

test.describe("thumbnails", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show table cover images with a srcset", async ({ libraryPage }) => {
    const table = libraryPage.table;
    const bookWithCover = FIXTURE_BOOKS.find((b) => b.hasCover);
    expect(
      bookWithCover,
      "expected at least one fixture book with hasCover=true",
    ).toBeTruthy();

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    // Thumb URLs are keyed by the book's uuid, as in `/api/thumbs/:uuid/:size`.
    await test.step("check the cover offers three sizes", async () => {
      const cover = table.coverImage(bookWithCover!.slug);
      await expect(cover).toBeVisible();
      await expect(cover).toHaveAttribute(
        "srcset",
        /\/api\/thumbs\/[0-9a-fA-F-]{36}\/sm/,
      );
      await expect(cover).toHaveAttribute("srcset", /160w/);
      await expect(cover).toHaveAttribute("srcset", /320w/);
      await expect(cover).toHaveAttribute("srcset", /640w/);
    });
  });

  test("serve an image from the thumb endpoint", async ({
    libraryPage,
    thumbsRequests,
  }) => {
    const table = libraryPage.table;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await expect(table.firstCoverImage).toBeVisible();
    });

    // The srcset reads like `/api/thumbs/<uuid>/sm 160w, …`.
    const bookUuid =
      await test.step("read a book's uuid off its cover", async () => {
        const srcset = await table.firstCoverSrcset();
        expect(srcset).not.toBeNull();
        const match = srcset?.match(/\/api\/thumbs\/([0-9a-fA-F-]{36})\/sm/);
        expect(match, "could not parse book uuid from srcset").not.toBeNull();
        return match![1]!;
      });

    // The first request may get the original cover while the WebP generates,
    // and a cold CI runner competing with the index took more than 10 s.
    await test.step("check the endpoint settles on a webp", async () => {
      await expect
        .poll(
          async () => {
            const response = await thumbsRequests.getThumbnail(bookUuid, "md");
            if (response.status() !== 200) return `status:${response.status()}`;
            return response.headers()["content-type"] ?? "missing";
          },
          {
            message: "expected /api/thumbs/{uuid}/md to return image/webp",
            timeout: 30_000,
            intervals: [200, 500, 1_000, 2_000, 3_000],
          },
        )
        .toContain("image/webp");
    });
  });

  test("show a dash for books without covers", async ({ libraryPage }) => {
    const table = libraryPage.table;
    const bookWithoutCover = FIXTURE_BOOKS.find((b) => !b.hasCover);
    expect(
      bookWithoutCover,
      "expected at least one fixture book with hasCover=false",
    ).toBeTruthy();
    const slug = bookWithoutCover!.slug;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    await test.step("check the cover cell shows only a dash", async () => {
      await expect(table.row(slug)).toBeVisible();
      await expect(table.coverCellImages(slug)).toHaveCount(0);
      await expect(table.coverFallback(slug)).toBeVisible();
    });
  });
});
