import { shelves } from "../contracts/shelves";
import { buildShelf } from "../data/shelves";
import { uniqueSuffix } from "../data/unique";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The admin sees every spec's shelves, so tests assert on their own by id.
test.describe("shelves index", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the shelves index layout", async ({ shelvesIndexPage }) => {
    await test.step("open the index", async () => {
      await shelvesIndexPage.goto();
    });

    await test.step("check the index and its controls", async () => {
      await shelvesIndexPage.assertDisplayed();
      await shelvesIndexPage.topNav.assertDisplayed();
      await expect(shelvesIndexPage.census).toBeVisible();
      await expect(shelvesIndexPage.newShelfButton).toBeVisible();
      await expect(shelvesIndexPage.filterField).toBeVisible();
      // The viewer's own shelves lead the page.
      await expect(shelvesIndexPage.firstGroupHeading).toHaveText(
        "Your shelves",
      );
    });
  });

  // The library's shelf section is the only way in: the top nav has no Shelves link.
  test("reach the index from the library's shelves row", async ({
    libraryPage,
    shelvesIndexPage,
  }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
      await expect(libraryPage.topNav.shelvesLink).toHaveCount(0);
    });

    await test.step("follow All shelves", async () => {
      await libraryPage.shelfGallery.openAllShelves();
    });

    await test.step("check the index shows", async () => {
      await shelvesIndexPage.assertDisplayed();
      await expect(shelvesIndexPage.indexRoot).toBeVisible();
    });
  });

  test("open a shelf from its card", async ({
    shelvesIndexPage,
    shelfPage,
    ownShelf,
  }) => {
    const shelf = await ownShelf("E2E Index Open");

    await test.step("open the index", async () => {
      await shelvesIndexPage.goto();
    });

    await test.step("open the shelf's card", async () => {
      await shelvesIndexPage.openShelf(shelf.id);
    });

    await test.step("check the shelf shows", async () => {
      await shelfPage.assertDisplayedFor(shelf.id);
      await expect(shelfPage.heading(shelf.name)).toBeVisible();
    });
  });

  test.describe("filters", () => {
    test("filter shelves by name", async ({ shelvesIndexPage, ownShelf }) => {
      const findable = await ownShelf("E2E Findable");
      const other = await ownShelf("E2E Elsewhere");

      await test.step("open the index", async () => {
        await shelvesIndexPage.goto();
      });

      // Terms match independently and case-insensitively.
      await test.step("filter by the first shelf's name", async () => {
        await shelvesIndexPage.filterBy(findable.name.toLowerCase());
      });

      await test.step("check only that shelf shows", async () => {
        await expect(shelvesIndexPage.shelfCard(findable.id)).toBeVisible();
        await expect(shelvesIndexPage.shelfCard(other.id)).toHaveCount(0);
        await expect(shelvesIndexPage.shelfCards).toHaveCount(1);
      });
    });

    test("offer a way back when nothing matches", async ({
      shelvesIndexPage,
      ownShelf,
    }) => {
      const shelf = await ownShelf("E2E Findable");

      await test.step("filter by a name no shelf has", async () => {
        await shelvesIndexPage.goto();
        await shelvesIndexPage.filterBy(`nothing is called ${shelf.name}`);
        await expect(shelvesIndexPage.emptyMessage).toContainText(
          "No shelves match",
        );
      });

      await test.step("clear the filters", async () => {
        await shelvesIndexPage.clearFilters();
      });

      await test.step("check the shelf is back", async () => {
        await expect(shelvesIndexPage.filterField).toHaveValue("");
        await expect(shelvesIndexPage.shelfCard(shelf.id)).toBeVisible();
      });
    });

    test("narrow the index to one kind of shelf", async ({
      shelvesIndexPage,
      ownShelf,
    }) => {
      const shelf = await ownShelf("E2E Kind");

      await test.step("open the index", async () => {
        await shelvesIndexPage.goto();
        await expect(shelvesIndexPage.shelfCard(shelf.id)).toBeVisible();
      });

      await test.step("narrow to wishlists", async () => {
        await shelvesIndexPage.narrowToWishlists();
      });

      await test.step("check only wishlists show", async () => {
        await expect(shelvesIndexPage.wishlistKindButton).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(shelvesIndexPage.shelfCard(shelf.id)).toHaveCount(0);
        // Every account has a Wishlist, so the filter never empties the page.
        await expect(shelvesIndexPage.firstShelfCard).toContainText("Wishlist");
      });

      await test.step("narrow to hand-picked shelves", async () => {
        await shelvesIndexPage.narrowToHandPicked();
        await expect(shelvesIndexPage.shelfCard(shelf.id)).toBeVisible();
      });
    });
  });

  test.describe("sorting", () => {
    test("sort shelves by size", async ({
      shelvesIndexPage,
      ownShelf,
      request,
    }) => {
      // Read-only fixture books: nothing here writes to them.
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const beta = await fetchBookUuidByTitle(request, "Beta in the Series");
      const stamp = uniqueSuffix();
      const small = await ownShelf(`E2E Sort A ${stamp}`, {
        book_uuids: [alpha],
      });
      const large = await ownShelf(`E2E Sort B ${stamp}`, {
        book_uuids: [alpha, beta],
      });

      await test.step("narrow the index to the two shelves", async () => {
        await shelvesIndexPage.goto();
        await shelvesIndexPage.filterBy(stamp);
      });

      await test.step("check they list by name", async () => {
        await expect
          .poll(() => shelvesIndexPage.shelfIds())
          .toEqual([small.id, large.id]);
      });

      await test.step("sort by size", async () => {
        await shelvesIndexPage.sortBySize();
      });

      await test.step("check the larger shelf leads", async () => {
        await expect
          .poll(() => shelvesIndexPage.shelfIds())
          .toEqual([large.id, small.id]);
        await expect(shelvesIndexPage.shelfCard(large.id)).toContainText(
          "2 books",
        );
      });
    });

    test("remember the sort choice across a reload", async ({
      shelvesIndexPage,
    }) => {
      await test.step("sort by size", async () => {
        await shelvesIndexPage.goto();
        await shelvesIndexPage.sortBySize();
      });

      await test.step("reload the index", async () => {
        await shelvesIndexPage.reload();
      });

      await test.step("check the sort is still by size", async () => {
        await expect(shelvesIndexPage.sortBySizeButton).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
    });
  });

  test.describe("owners", () => {
    test("group another reader's shelves under their name", async ({
      shelvesIndexPage,
      readerAccount,
    }) => {
      const { id, username } = readerAccount;
      // Their account brings a public Wishlist, which is all the index needs.
      await test.step("open the index", async () => {
        await shelvesIndexPage.goto();
      });

      await test.step("check the reader's group names them", async () => {
        const heading = shelvesIndexPage.ownerGroupHeading(id);
        await expect(heading).toBeVisible();
        await expect(heading).toContainText(`${username}’s shelves`);
        await expect(shelvesIndexPage.ownerGroup(id)).toContainText(
          `${username}'s Wishlist`,
        );
      });
    });

    test("filter the index to one owner and widen back to everyone", async ({
      shelvesIndexPage,
      readerAccount,
    }) => {
      const { id } = readerAccount;

      await test.step("pick the reader", async () => {
        await shelvesIndexPage.goto();
        await shelvesIndexPage.pickOwner(id);
      });

      await test.step("check only their group shows", async () => {
        await expect(shelvesIndexPage.ownerChip(id)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(shelvesIndexPage.shelfGroups).toHaveCount(1);
        await expect(shelvesIndexPage.ownerGroup(id)).toBeVisible();
      });

      await test.step("pick the same reader again", async () => {
        await shelvesIndexPage.pickOwner(id);
      });

      await test.step("check everyone shows", async () => {
        await expect(shelvesIndexPage.everyoneChip).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect
          .poll(() => shelvesIndexPage.groupCount())
          .toBeGreaterThan(1);
      });
    });
  });

  test("create a shelf from the index", async ({
    shelvesIndexPage,
    shelfPage,
    createdShelfIds,
    expectMutation,
  }) => {
    const { name } = buildShelf("E2E Index Create");
    const modal = shelvesIndexPage.createShelfModal;

    await test.step("fill in the New shelf modal", async () => {
      await shelvesIndexPage.goto();
      await shelvesIndexPage.openNewShelf();
      await modal.fillHandPickedShelf(name);
    });

    await test.step("create the shelf", async () => {
      const { response } = await expectMutation(shelves.create(), () =>
        modal.create(),
      );
      const { id }: { id: number } = await response.json();
      createdShelfIds.add(id);
    });

    await test.step("check the new shelf's page shows", async () => {
      await shelfPage.assertDisplayed();
      await expect(shelfPage.heading(name)).toBeVisible();
    });
  });

  test("surface an error when the shelf list fails to load", async ({
    shelvesIndexPage,
  }) => {
    await test.step("fail the shelf list and open the index", async () => {
      await shelvesIndexPage.forceServerError(shelves.list());
      await shelvesIndexPage.gotoUnavailable();
    });

    await test.step("check the index says it failed", async () => {
      await expect(shelvesIndexPage.errorAlert).toBeVisible();
      await expect(shelvesIndexPage.indexRoot).toHaveCount(0);
    });
  });
});
