import { type AddedBook, addedDateText, crossesUtcDay } from "../data/ebooks";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

const ZONES = [
  { name: "behind UTC", timezoneId: "Etc/GMT+12", offsetHours: -12 },
  { name: "ahead of UTC", timezoneId: "Etc/GMT-14", offsetHours: 14 },
];

test.describe("library page", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the library layout", async ({ libraryPage }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the page chrome shows", async () => {
      await libraryPage.assertDisplayed();
      await libraryPage.topNav.assertDisplayed();
      await expect(libraryPage.libraryHeading).toBeVisible();
      // Grid is the default view; the table is opt-in via the toolbar.
      await expect(libraryPage.grid).toBeVisible();
      await expect(libraryPage.toolbar).toBeVisible();
    });

    // `marquee.js` arms the paging buttons only at an end with more to show.
    await test.step("check the shelves row shows", async () => {
      await expect(libraryPage.shelfGallery.root).toBeVisible();
      await expect(libraryPage.shelfGallery.allBooksTile).toBeVisible();
      await expect(libraryPage.shelfGallery.newShelfButton).toBeVisible();
      await expect(libraryPage.shelfGallery.previousArrow).toBeAttached();
      await expect(libraryPage.shelfGallery.nextArrow).toBeAttached();
    });
  });

  test("keep captions off the covers until hover", async ({ libraryPage }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
      await expect(libraryPage.firstBookTile).toBeVisible();
    });

    // `toBeHidden` misses this: an opacity-0 caption still counts as visible.
    await test.step("check the caption is transparent", async () => {
      await expect(libraryPage.firstBookTileCaption).toHaveCSS("opacity", "0");
    });

    await test.step("hover the tile", async () => {
      await libraryPage.hoverFirstBookTile();
    });

    await test.step("check the caption shows", async () => {
      await expect(libraryPage.firstBookTileCaption).toHaveCSS("opacity", "1");
    });
  });

  test("show every fixture book with its metadata", async ({ libraryPage }) => {
    const table = libraryPage.table;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    // Parallel specs may have seeded audiobooks on the shared server too.
    await test.step("check every fixture book has a row", async () => {
      expect(await table.rows.count()).toBeGreaterThanOrEqual(
        FIXTURE_BOOKS.length,
      );
    });

    for (const book of FIXTURE_BOOKS) {
      await test.step(`check "${book.title}" from ${book.filename}`, async () => {
        await table.assertRowMatches(book);
      });
    }
  });

  for (const zone of ZONES) {
    test.describe(`in a zone ${zone.name}`, () => {
      test.use({ timezoneId: zone.timezoneId });

      test("show the added date on the reader's day, as the detail page does", async ({
        libraryPage,
        bookDetailPage,
        ebooksRequests,
      }) => {
        const book = FIXTURE_BOOKS[0]!;

        const listed = await ebooksRequests.getEbooks();
        await expect(listed).toBeOK();
        const { books }: { books: AddedBook[] } = await listed.json();
        const added = books.find((b) => b.title === book.title);
        expect(
          added?.added_at,
          `${book.title} carries an added_at`,
        ).toBeTruthy();
        const addedMs = Date.parse(added!.added_at!);

        // Only a zone whose day differs from UTC's for this instant proves anything.
        test.skip(
          !crossesUtcDay(addedMs, zone.offsetHours),
          "this zone shares UTC's day for the instant the book was added",
        );
        const expected = addedDateText(addedMs, zone.offsetHours);

        await test.step("check the table cell", async () => {
          await libraryPage.goto();
          await libraryPage.table.switchTo();
          await expect(libraryPage.table.cell(book.slug, "added")).toHaveText(
            expected,
          );
        });

        await test.step("check the detail page", async () => {
          await bookDetailPage.goto(added!.unique_identifier!);
          await expect(bookDetailPage.metaValue("Added")).toHaveText(expected);
        });
      });
    });
  }

  test("browse the fixture library in one keyset page", async ({
    libraryPage,
  }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
      await expect(libraryPage.firstBookTile).toBeVisible();
    });

    // The fixtures sit far under the 100-book page size, so one page holds them all.
    await test.step("check one page holds every book with no load more", async () => {
      expect(await libraryPage.bookTiles.count()).toBeGreaterThanOrEqual(
        FIXTURE_BOOKS.length,
      );
      await expect(libraryPage.loadMoreButton).toHaveCount(0);
    });
  });

  // The view lives in localStorage, which each test's fresh context starts
  // without, so no cleanup is needed.
  test("toggle to table view and keep it across a reload", async ({
    libraryPage,
  }) => {
    const table = libraryPage.table;

    await test.step("open the library as a grid", async () => {
      await libraryPage.goto();
      await expect(libraryPage.grid).toBeVisible();
    });

    await test.step("switch to the table", async () => {
      await table.switchTo();
      await expect(libraryPage.grid).toHaveCount(0);
      expect(await table.rows.count()).toBeGreaterThanOrEqual(
        FIXTURE_BOOKS.length,
      );
      await expect(table.viewToggleButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("reload the page", async () => {
      await libraryPage.reload();
    });

    await test.step("check the table is still showing", async () => {
      await expect(table.root).toBeVisible();
      await expect(libraryPage.grid).toHaveCount(0);
    });
  });

  test("sort by title descending from the title header", async ({
    libraryPage,
  }) => {
    const table = libraryPage.table;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    // The default sort is title ascending, so one click flips it.
    await test.step("click the title header", async () => {
      await table.sortByTitle();
      await expect(table.descendingHeader).toBeVisible();
    });

    await test.step("check the alphabetically last book comes first", async () => {
      const titles = FIXTURE_BOOKS.map((book) => book.title).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      );
      await expect(table.firstRowTitleCell).toHaveText(titles.at(-1)!);
    });
  });

  // Only the markup is pinned here. A spec would have to write a library-wide
  // rating or status to prove the order, so the Rust suite covers that.
  test("offer Recently Interacted in the sort menu, newest first", async ({
    libraryPage,
  }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
      await expect(libraryPage.sortSelect).toBeVisible();
      await expect(
        libraryPage.sortOption("Recently Interacted"),
      ).toHaveAttribute("value", "recently_interacted");
    });

    await test.step("pick the sort", async () => {
      await libraryPage.sortBy("recently_interacted");
      await expect(libraryPage.sortSelect).toHaveValue("recently_interacted");
      // A recency axis defaults to descending.
      await expect(libraryPage.sortDirectionButton).toHaveText("↓");
    });

    await test.step("check the table still lists the whole library", async () => {
      await libraryPage.table.switchTo();
      expect(await libraryPage.table.rows.count()).toBeGreaterThanOrEqual(
        FIXTURE_BOOKS.length,
      );
    });
  });
});
