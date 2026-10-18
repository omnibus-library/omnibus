import { overrides } from "../contracts/overrides";
import { shelves } from "../contracts/shelves";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The two `bulk-target-*` fixtures are reserved for this spec (see
// fixtures/epubs.ts): the happy path bulk-writes overrides to both, and the
// suite is fullyParallel, so nothing else may read them.
const TARGETS = FIXTURE_BOOKS.filter((b) => b.slug.startsWith("bulk-target-"));
const [PRIMARY, SECONDARY] = [TARGETS[0]!, TARGETS[1]!];
const SELECTED = [PRIMARY.slug, SECONDARY.slug];

test.describe("bulk edit", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the bulk edit layout", async ({ libraryPage }) => {
    const table = libraryPage.table;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    await test.step("check the checkboxes show and no bar yet", async () => {
      await expect(table.selectAllBox).toBeVisible();
      await expect(table.selectBox(PRIMARY.slug)).toBeVisible();
      await expect(table.selectBox(SECONDARY.slug)).toBeVisible();
      await expect(libraryPage.bulkEditBar.root).toHaveCount(0);
    });
  });

  test("select rows to reveal the bulk edit bar", async ({ libraryPage }) => {
    const { table, bulkEditBar } = libraryPage;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    await test.step("select two rows", async () => {
      await table.selectRows(SELECTED);
    });

    await test.step("check the bar shows without opening a book", async () => {
      // The checkbox cell stops propagation, so the row's navigate must not fire.
      await libraryPage.assertDisplayed();
      await expect(bulkEditBar.root).toContainText("2 books selected");
      // The bar ties `.lmq > *` on specificity; losing the tie drops it into
      // the flow, far below the rows it reports on.
      await expect.poll(() => bulkEditBar.position()).toBe("fixed");
    });

    await test.step("clear the selection", async () => {
      await bulkEditBar.clear();
      await expect(bulkEditBar.root).toHaveCount(0);
    });
  });

  test("select all rows", async ({ libraryPage }) => {
    const { table, bulkEditBar } = libraryPage;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    await test.step("select all", async () => {
      await table.selectAll();
      const rowCount = await table.selectBoxes.count();
      await expect(bulkEditBar.root).toContainText(
        `${rowCount} books selected`,
      );
    });

    await test.step("deselect all", async () => {
      await table.deselectAll();
      await expect(bulkEditBar.root).toHaveCount(0);
    });
  });

  test("bulk edit publisher and tags across the selected books", async ({
    libraryPage,
    expectMutation,
    revertOverridesOf,
  }) => {
    const { table, bulkEditBar, bulkEditModal } = libraryPage;
    await revertOverridesOf(PRIMARY.title, SECONDARY.title);

    await test.step("select two rows and open the editor", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.selectRows(SELECTED);
      await bulkEditBar.openEditor();
      await expect(bulkEditModal.root).toBeVisible();
      await expect(bulkEditModal.root).toContainText("Edit 2 books");
    });

    await test.step("fill in a publisher and a tag", async () => {
      await bulkEditModal.setPublisher("Bulk Edited Press");
      await bulkEditModal.addTag("bulk-tagged");
    });

    await test.step("save the edit", async () => {
      await expectMutation(overrides.bulkSave(), () => bulkEditModal.submit());
    });

    // The rows re-render from the returned metadata. Publisher has no table
    // column, so the request contract above is its only check.
    await test.step("check the rows carry the tag", async () => {
      await expect(bulkEditModal.root).toHaveCount(0);
      await expect(bulkEditBar.root).toHaveCount(0);
      for (const slug of SELECTED) {
        await expect(table.cell(slug, "tags")).toContainText("bulk-tagged");
      }
    });
  });

  test("keep the bulk edit modal open when saving fails", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { table, bulkEditBar, bulkEditModal } = libraryPage;

    await test.step("fill in the editor for two rows", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.selectRows(SELECTED);
      await bulkEditBar.openEditor();
      await bulkEditModal.setPublisher("Should Not Persist");
      await bulkEditModal.addTag("should-not-persist");
    });

    await test.step("save while the server fails", async () => {
      await libraryPage.forceServerError(overrides.bulkSave());
      await expectMutation(failing(overrides.bulkSave()), () =>
        bulkEditModal.submit(),
      );
    });

    await test.step("check the modal reports the failure and the rows are unchanged", async () => {
      await expect(bulkEditModal.errorMessage).toBeVisible();
      await expect(bulkEditModal.root).toBeVisible();
      for (const slug of SELECTED) {
        await expect(table.cell(slug, "tags")).not.toContainText(
          "should-not-persist",
        );
      }
    });
  });

  test("add the selected books to a hand-picked shelf in one request", async ({
    libraryPage,
    ownShelf,
    expectMutation,
    request,
  }) => {
    const { table, bulkEditBar } = libraryPage;
    const picker = bulkEditBar.shelfPicker;
    const bookUuids = (
      await Promise.all(
        [PRIMARY, SECONDARY].map((t) => fetchBookUuidByTitle(request, t.title)),
      )
    ).sort();
    const shelf = await ownShelf("E2E Bulk Shelf");

    await test.step("select two rows and open the shelf picker", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.selectRows(SELECTED);
      await bulkEditBar.openShelfPicker();
      await expect(picker.heading("Add 2 books to a shelf")).toBeVisible();
    });

    await test.step("pick the shelf", async () => {
      await expectMutation(shelves.addBooks(shelf.id, bookUuids), () =>
        bulkEditBar.chooseShelf(shelf.name),
      );
    });

    // The gallery's count follows without a reload.
    await test.step("check the picker and selection are gone", async () => {
      await expect(picker.root).toHaveCount(0);
      await expect(bulkEditBar.root).toHaveCount(0);
      await expect(libraryPage.galleryShelfTile(shelf.id)).toContainText(
        "2 books",
      );
      for (const slug of SELECTED) {
        await expect(table.selectBox(slug)).not.toBeChecked();
      }
    });
  });

  test("keep the selection when adding to a shelf fails", async ({
    libraryPage,
    ownShelf,
    expectMutation,
    request,
  }) => {
    const { table, bulkEditBar } = libraryPage;
    const picker = bulkEditBar.shelfPicker;
    const bookUuids = (
      await Promise.all(
        [PRIMARY, SECONDARY].map((t) => fetchBookUuidByTitle(request, t.title)),
      )
    ).sort();
    const shelf = await ownShelf("E2E Bulk Shelf");

    await test.step("select two rows and open the shelf picker", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.selectRows(SELECTED);
      await bulkEditBar.openShelfPicker();
    });

    await test.step("pick the shelf while the server fails", async () => {
      await libraryPage.forceServerError(shelves.addBooks());
      await expectMutation(failing(shelves.addBooks(shelf.id, bookUuids)), () =>
        bulkEditBar.chooseShelf(shelf.name),
      );
    });

    await test.step("check the picker reports the failure and the selection stays", async () => {
      await expect(picker.errorMessage).toBeVisible();
      await expect(picker.root).toBeVisible();
      await expect(bulkEditBar.root).toContainText("2 books selected");
    });

    await test.step("close the picker", async () => {
      await bulkEditBar.closeShelfPicker();
      await expect(picker.root).toHaveCount(0);
      await expect(bulkEditBar.root).toContainText("2 books selected");
    });
  });
});
