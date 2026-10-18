import { shelves } from "../contracts/shelves";
import {
  authorRule,
  buildShelf,
  buildShelfUpdate,
  smartShelfBy,
} from "../data/shelves";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { topEdge } from "../utils/dom";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// A shelf opens by its gallery tile, which filters the list in place; nothing deep-links it.
test.describe("shelves on the library page", () => {
  // The create modal's picker and the gallery need real books to work with.
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the shelf gallery layout", async ({ libraryPage }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the gallery and its controls", async () => {
      await libraryPage.assertDisplayed();
      await libraryPage.topNav.assertDisplayed();
      await expect(libraryPage.shelfGallery.root).toBeVisible();
      await expect(libraryPage.shelfGallery.allBooksTile).toBeVisible();
      await expect(libraryPage.shelfGallery.newShelfButton).toBeVisible();
    });
  });

  test.describe("creating", () => {
    test("float the create-shelf modal above the page, not in the book column", async ({
      libraryPage,
    }) => {
      const modal = libraryPage.createShelfModal;

      await test.step("open the create-shelf modal", async () => {
        await libraryPage.goto();
        await libraryPage.shelfGallery.openNewShelf();
        await expect(modal.root).toBeVisible();
      });

      // Losing a specificity tie to `.lmq > *` re-anchors the overlay into the flow.
      await test.step("check the modal is fixed to the viewport", async () => {
        await expect.poll(() => modal.cssPosition()).toBe("fixed");
      });

      // An in-flow overlay scrolls away with the column; a floating one does not.
      await test.step("scroll the page under it", async () => {
        await modal.scrollPageUnder();
        await expect.poll(() => topEdge(modal.root)).toBe(0);
      });
    });

    test("create a hand-picked shelf", async ({
      libraryPage,
      createdShelfIds,
      expectMutation,
    }) => {
      const { name } = buildShelf("E2E Picks");
      const modal = libraryPage.createShelfModal;

      await test.step("fill in the New shelf modal", async () => {
        await libraryPage.goto();
        await libraryPage.shelfGallery.openNewShelf();
        await expect(modal.root).toBeVisible();
        await modal.fillHandPickedShelf(name);
      });

      const id = await test.step("create the shelf", async () => {
        const { response } = await expectMutation(shelves.create(), () =>
          modal.create(),
        );
        const { id }: { id: number } = await response.json();
        createdShelfIds.add(id);
        return id;
      });

      await test.step("check the gallery lists it", async () => {
        await expect(libraryPage.galleryShelfTile(id)).toBeVisible();
        await expect(libraryPage.galleryShelfTile(id)).toContainText(name);
      });
    });

    test("surface an error when shelf creation fails", async ({
      libraryPage,
      expectMutation,
    }) => {
      const modal = libraryPage.createShelfModal;

      await test.step("fill in the New shelf modal", async () => {
        await libraryPage.goto();
        await libraryPage.forceServerError(shelves.create());
        await libraryPage.shelfGallery.openNewShelf();
        await modal.fillHandPickedShelf("Doomed shelf");
      });

      await test.step("create the shelf", async () => {
        await expectMutation(failing(shelves.create()), () => modal.create());
      });

      await test.step("check the modal says it failed", async () => {
        await expect(modal.errorMessage).toBeVisible();
      });
    });
  });

  test.describe("selecting", () => {
    test("surface a distinct error when the member-books refetch fails", async ({
      libraryPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Refetch Fail");

      // An empty shelf shows no error text, so only a forced 500 draws the banner.
      await test.step("fail the member fetch and open the library", async () => {
        await libraryPage.forceServerError(shelves.page());
        await libraryPage.goto();
      });

      await test.step("select the shelf", async () => {
        await expectMutation(failing(shelves.page()), () =>
          libraryPage.selectShelf(shelf),
        );
      });

      await test.step("check the library says it failed", async () => {
        await expect(libraryPage.sectionTitle).toContainText(shelf.name);
        await expect(libraryPage.pageError).toBeVisible();
      });
    });

    // Each shelf holds one distinct book, so the grid can only match if the pick re-fetched.
    test("switch shelves via the gallery without leaving the library page", async ({
      libraryPage,
      ownShelf,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const beta = await fetchBookUuidByTitle(request, "Beta in the Series");
      const shelfA = await ownShelf("E2E Rail A", { book_uuids: [alpha] });
      const shelfB = await ownShelf("E2E Rail B", { book_uuids: [beta] });

      await test.step("select the first shelf", async () => {
        await libraryPage.goto();
        await libraryPage.selectShelf(shelfA);
        await expect(libraryPage.grid).toContainText("Alpha");
      });

      await test.step("select the second shelf", async () => {
        await libraryPage.selectShelf(shelfB);
        await expect(libraryPage.grid).toContainText("Beta in the Series");
        await expect(libraryPage.grid).not.toContainText("Alpha");
      });

      await test.step("select the first shelf again", async () => {
        await libraryPage.selectShelf(shelfA);
        await expect(libraryPage.grid).toContainText("Alpha");
        await expect(libraryPage.grid).not.toContainText("Beta in the Series");
      });

      await test.step("check the library never navigated", async () => {
        await libraryPage.assertDisplayed();
      });
    });

    // A manual shelf is ordered server-side, so its sort controls reach nothing (#2507).
    test("lock the sort controls inside a hand-picked shelf and free them for a smart one", async ({
      libraryPage,
      ownShelf,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const manual = await ownShelf("E2E Sort Lock", { book_uuids: [alpha] });
      const smart = await ownShelf(
        "E2E Sort Live",
        smartShelfBy("Ada Lovelace"),
      );

      await test.step("select the hand-picked shelf", async () => {
        await libraryPage.goto();
        await libraryPage.selectShelf(manual);
      });

      await test.step("check the sort controls are locked", async () => {
        await expect(libraryPage.sortSelect).toBeDisabled();
        await expect(libraryPage.sortDirectionButton).toBeDisabled();
        await expect(libraryPage.sortLockedNote).toHaveText("shelf order");
      });

      await test.step("check the table's column headers respect the lock", async () => {
        await libraryPage.table.switchTo();
        await expect(libraryPage.table.titleSortButton).toBeDisabled();
        await expect(libraryPage.table.titleColumnHeader).toHaveAttribute(
          "aria-sort",
          "none",
        );
        await libraryPage.switchToGrid();
      });

      await test.step("select the smart shelf", async () => {
        await libraryPage.selectShelf(smart);
      });

      await test.step("check the sort controls are free", async () => {
        await expect(libraryPage.sortSelect).toBeEnabled();
        await expect(libraryPage.sortDirectionButton).toBeEnabled();
        await expect(libraryPage.sortLockedNote).toHaveCount(0);
      });
    });
  });

  test.describe("editing", () => {
    // Ada Lovelace and Grace Hopper match disjoint pairs, so only the edit moves the members.
    test("edit a smart shelf's rules and the member grid updates", async ({
      libraryPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf(
        "E2E Smart Edit",
        smartShelfBy("Ada Lovelace"),
      );
      const editor = libraryPage.editShelfModal;

      await test.step("select the shelf", async () => {
        await libraryPage.goto();
        await libraryPage.selectShelf(shelf);
        await expect(libraryPage.grid).toContainText("Alpha");
        await expect(libraryPage.grid).not.toContainText("Beta in the Series");
        await expect(libraryPage.shelfFacets).toContainText("Smart shelf");
        await expect(libraryPage.shelfFacets).toContainText(
          "Author is Ada Lovelace",
        );
      });

      await test.step("open the editor", async () => {
        await libraryPage.openEditShelf();
        await expect(editor.root).toBeVisible();
        await expect(editor.ruleValueField(0)).toHaveValue("Ada Lovelace");
        await expect(editor.rulePreviewCount).toContainText("2 of");
      });

      await test.step("point the rule at another author", async () => {
        await editor.changeRuleValue(0, "Grace Hopper");
        await expect(editor.rulePreviewCount).toContainText("2 of");
      });

      // The modal always states the Kobo toggle's value for a non-system shelf.
      await test.step("save it", async () => {
        await expectMutation(
          shelves.update(
            shelf.id,
            buildShelfUpdate({
              name: shelf.name,
              visibility: "private",
              match_mode: "any",
              rules: [authorRule("Grace Hopper")],
            }),
          ),
          () => editor.save(),
        );
      });

      await test.step("check the members follow the rule", async () => {
        await expect(editor.root).not.toBeVisible();
        await expect(libraryPage.shelfFacets).toContainText(
          "Author is Grace Hopper",
        );
        await expect(libraryPage.grid).toContainText("Beta in the Series");
        await expect(libraryPage.grid).not.toContainText("Alpha");
      });
    });

    test("edit a shelf's name, visibility, and Kobo sync from the pencil modal", async ({
      libraryPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Edit Fields");
      const renamed = `${shelf.name} (renamed)`;
      const editor = libraryPage.editShelfModal;

      await test.step("select the shelf", async () => {
        await libraryPage.goto();
        await libraryPage.selectShelf(shelf);
        await expect(libraryPage.shelfFacets).toContainText(
          "Hand-picked shelf",
        );
        await expect(libraryPage.shelfFacets).toContainText("Private");
      });

      await test.step("open the editor", async () => {
        await libraryPage.openEditShelf();
        await expect(editor.nameField).toHaveValue(shelf.name);
        // The Kobo opt-in prefills from the shelf: off for a fresh one.
        await expect(editor.koboOffButton).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });

      await test.step("rename it, make it public and turn Kobo sync on", async () => {
        await editor.rename(renamed);
        await editor.makePublic();
        await editor.turnKoboSyncOn();
      });

      // The Kobo badge lives on the shelf page, so the opt-in is asserted on the wire.
      await test.step("save it", async () => {
        await expectMutation(
          shelves.update(
            shelf.id,
            buildShelfUpdate({
              name: renamed,
              visibility: "public",
              sync_to_kobo: true,
            }),
          ),
          () => editor.save(),
        );
      });

      await test.step("check the header shows the edit", async () => {
        await expect(editor.root).not.toBeVisible();
        await expect(libraryPage.sectionTitle).toContainText(renamed);
        await expect(libraryPage.shelfFacets).toContainText("Public");
      });
    });

    test("surface an error when the shelf edit save fails", async ({
      libraryPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Edit Fail");
      const editor = libraryPage.editShelfModal;

      await test.step("rename the selected shelf in the editor", async () => {
        await libraryPage.goto();
        await libraryPage.selectShelf(shelf);
        await libraryPage.forceServerError(shelves.update());
        await libraryPage.openEditShelf();
        await editor.rename(`${shelf.name} v2`);
      });

      await test.step("save it", async () => {
        await expectMutation(failing(shelves.update()), () => editor.save());
      });

      // The header keeps the saved name: the failed edit must not leak in.
      await test.step("check the editor says it failed", async () => {
        await expect(editor.errorMessage).toBeVisible();
        await expect(libraryPage.sectionTitle).toContainText(shelf.name);
        await expect(libraryPage.sectionTitle).not.toContainText("v2");
      });
    });
  });
});
