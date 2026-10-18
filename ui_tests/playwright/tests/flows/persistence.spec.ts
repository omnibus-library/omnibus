import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// An index's sort (`index_prefs`) and a page's scroll position (`scroll_restore`)
// persist per browser context. Each test gets a fresh one, so localStorage and
// the in-memory scroll map start empty.
test.beforeAll("seed the library", async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test.describe("sort persistence", () => {
  test("keep the authors sort across a reload", async ({
    authorsIndexPage,
  }) => {
    await test.step("open the authors index on its default sort", async () => {
      await authorsIndexPage.goto();
      await expect(authorsIndexPage.sortByNameButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("sort by most books", async () => {
      await authorsIndexPage.sortByCount();
      await expect(authorsIndexPage.sortByCountButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("reload", async () => {
      await authorsIndexPage.reloadAndSettle();
    });

    await test.step("check the chosen sort comes back", async () => {
      // The axis is restored from storage once the fetch resolves.
      await expect(authorsIndexPage.sortByCountButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(authorsIndexPage.sortByNameButton).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  test("keep the series sort across a reload", async ({ seriesIndexPage }) => {
    await test.step("open the series index on its default sort", async () => {
      await seriesIndexPage.goto();
      await expect(seriesIndexPage.sortByNameButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("sort by most books", async () => {
      await seriesIndexPage.sortByCount();
      await expect(seriesIndexPage.sortByCountButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("reload", async () => {
      await seriesIndexPage.reloadAndSettle();
    });

    await test.step("check the chosen sort comes back", async () => {
      await expect(seriesIndexPage.sortByCountButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(seriesIndexPage.sortByNameButton).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  test("apply the landing sort to the first page fetch after a reload", async ({
    libraryPage,
  }) => {
    let titleOrder: string[] = [];
    let sortedTitles: string[] = [];
    let fetchBodies: string[] = [];

    await test.step("open the library on its default sort", async () => {
      await libraryPage.goto();
      await expect(libraryPage.firstBookTile).toBeVisible();
      titleOrder = await libraryPage.tileTitles();
    });

    await test.step("sort by author", async () => {
      await libraryPage.sortBy("author");
      await expect(libraryPage.sortSelect).toHaveValue("author");
      // The refetch repaints after network idle can resolve, so wait for the grid to move off the title order.
      await expect
        .poll(() => libraryPage.tileTitles(), {
          message: "the grid never left the title order",
        })
        .not.toEqual(titleOrder);
      sortedTitles = await libraryPage.tileTitles();
    });

    await test.step("reload", async () => {
      fetchBodies = libraryPage.recordPageFetches();
      await libraryPage.reloadAndSettle();
      await expect(libraryPage.firstBookTile).toBeVisible();
    });

    await test.step("check the first fetch already carries the saved sort", async () => {
      // Before #1818 the first body always said "title". Quoted, because `"author"` must not match the `"authors"` filter key.
      expect(fetchBodies.length).toBeGreaterThan(0);
      expect(fetchBodies[0]).toContain('"author"');
      expect(fetchBodies[0]).not.toContain('"title"');
    });

    await test.step("check the grid never paints the default order", async () => {
      // Other specs seed books between the snapshots, so compare only titles in both: insertions cannot reorder the rest, a title-sorted paint would.
      const after = await libraryPage.tileTitles();
      const common = new Set(
        sortedTitles.filter((title) => after.includes(title)),
      );
      expect(common.size).toBeGreaterThan(1);
      expect(after.filter((title) => common.has(title))).toEqual(
        sortedTitles.filter((title) => common.has(title)),
      );
    });
  });

  test("fall back to the default landing sort when nothing is persisted", async ({
    libraryPage,
  }) => {
    // A first visit has no stored library pointer, so the fetch must still go
    // out on defaults instead of waiting for prefs that never land.
    const fetchBodies = libraryPage.recordPageFetches();

    await test.step("open the library for the first time", async () => {
      await libraryPage.goto();
      await expect(libraryPage.firstBookTile).toBeVisible();
    });

    await test.step("check the fetch and the sort use the defaults", async () => {
      expect(fetchBodies.length).toBeGreaterThan(0);
      expect(fetchBodies[0]).toContain('"title"');
      await expect(libraryPage.sortSelect).toHaveValue("title");
    });
  });
});

// A short viewport makes even the small fixture set overflow and scroll.
test.describe("scroll restoration", () => {
  test.use({ viewport: { width: 1000, height: 320 } });

  test("restore the library scroll position after opening a book", async ({
    libraryPage,
    bookDetailPage,
    authorsIndexPage,
  }) => {
    let savedY = 0;
    let restoredY = 0;
    let movedY = 0;

    await test.step("scroll the library to the bottom", async () => {
      await libraryPage.goto();
      // The grid is the default view and its tiles navigate on click, unlike
      // table rows, where clicking a title cell enters edit mode.
      await expect(libraryPage.firstBookTile).toBeVisible();
      await libraryPage.scroll.toBottom();
      savedY = await libraryPage.scroll.y();
      expect(savedY).toBeGreaterThan(0);
    });

    await test.step("open the last book and go back", async () => {
      // The last tile is visible at the bottom, so the click does not scroll.
      await libraryPage.openLastBook();
      await bookDetailPage.assertDisplayed();
      await libraryPage.goBack();
      await expect(libraryPage.firstBookTile).toBeVisible();
    });

    await test.step("check the scroll position is restored", async () => {
      await expect
        .poll(() => libraryPage.scroll.y(), {
          message: "the library scroll was not restored",
          timeout: 5000,
        })
        .toBeGreaterThan(savedY * 0.6);
    });

    await test.step("scroll somewhere new to check recording came back", async () => {
      // Sized off where the restore landed, not `savedY`: a `savedY`-sized wheel can overshoot to 0,
      // and `restore` bails on a zero target. The 1px nudge first stops the converge loop.
      await libraryPage.scroll.wheelUp(1);
      restoredY = await libraryPage.scroll.settledY();
      expect(restoredY).toBeGreaterThan(0);

      await libraryPage.scroll.wheelUp(Math.round(restoredY / 2));
      movedY = await libraryPage.scroll.settledY();
      expect(movedY).toBeGreaterThan(0);
      expect(movedY).toBeLessThan(restoredY);
    });

    await test.step("leave through the nav and go back", async () => {
      // The sticky nav does not move the page on the way out, unlike an off-screen tile.
      await libraryPage.topNav.open("Authors");
      await authorsIndexPage.assertDisplayed();
      await libraryPage.goBack();
      await expect(libraryPage.firstBookTile).toBeVisible();
    });

    await test.step("check the new offset comes back, not the old one", async () => {
      // A recorder left frozen by the first restore would hold the grid's
      // bottom and land back down there.
      await expect
        .poll(() => libraryPage.scroll.y(), {
          message: "the library scroll did not return to the new offset",
          timeout: 5000,
        })
        .toBeGreaterThan(movedY * 0.6);
      expect(await libraryPage.scroll.settledY()).toBeLessThan(movedY * 1.4);
    });
  });
});

// Below `--au-split` the authors list and an author take the screen in turn,
// and the window scrolls; the layout stays mounted across both routes, so the
// restore must run on the route change rather than on a remount.
test.describe("authors scroll restoration, one pane at a time", () => {
  test.use({ viewport: { width: 800, height: 320 } });

  test("restore the authors index scroll position after visiting an author", async ({
    authorsIndexPage,
    authorPage,
  }) => {
    let savedY = 0;

    await test.step("scroll the authors index to the bottom", async () => {
      await authorsIndexPage.goto();
      await expect(authorsIndexPage.firstCard).toBeVisible();
      await authorsIndexPage.scroll.toBottom();
      // The clamped offset the manager records for this path.
      savedY = await authorsIndexPage.scroll.y();
      expect(savedY).toBeGreaterThan(0);
    });

    await test.step("open the last author and go back", async () => {
      // The last card is visible at the bottom, so clicking it does not scroll
      // the window and overwrite the saved offset.
      await authorsIndexPage.openLastCard();
      await authorPage.assertDisplayed();
      await authorsIndexPage.goBack();
      await expect(authorsIndexPage.firstCard).toBeVisible();
    });

    await test.step("check the scroll position is restored", async () => {
      // The restore converges after the list re-fetches and paints.
      await expect
        .poll(() => authorsIndexPage.scroll.y(), {
          message: "the authors index scroll was not restored",
          timeout: 5000,
        })
        .toBeGreaterThan(savedY * 0.6);
    });
  });
});

// Two panes: the list scrolls in its own scroller, which opening an author
// must leave where it was.
test.describe("authors list scroll beside an author", () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test("keep the authors list's place while opening an author", async ({
    authorsIndexPage,
    authorPage,
  }) => {
    let savedTop = 0;

    await test.step("scroll the authors list to the bottom", async () => {
      await authorsIndexPage.goto();
      await expect(authorsIndexPage.firstCard).toBeVisible();
      await authorsIndexPage.scrollListToBottom();
      savedTop = await authorsIndexPage.listScrollTop();
      expect(savedTop).toBeGreaterThan(0);
    });

    await test.step("open the last author", async () => {
      await authorsIndexPage.openLastCard();
      await authorPage.assertDisplayed();
    });

    await test.step("check the list kept its place", async () => {
      expect(await authorsIndexPage.listScrollTop()).toBe(savedTop);
    });
  });
});
