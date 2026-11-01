import { shelves } from "../contracts/shelves";
import { authorRule, buildShelf, smartShelfBy } from "../data/shelves";
import { AUDIOBOOK_BOOK_COUNT } from "../fixtures/audiobooks";
import { AUTO_ATTACHED_PAIRS } from "../fixtures/dual_format";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { topEdge } from "../utils/dom";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

// A shelf opens by its gallery tile, which filters the list in place; nothing deep-links it.
// The row carries only shelves that hold a book, so every shelf here starts with one.
test.describe("shelves on the library page", () => {
  // The create modal's picker and the gallery need real books to work with.
  // Audiobooks too: each author the smart shelves match wrote an EPUB and an audiobook.
  test.beforeAll("seed both libraries", async ({ request }) => {
    test.setTimeout(120_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      FIXTURE_BOOKS.length + AUDIOBOOK_BOOK_COUNT - AUTO_ATTACHED_PAIRS,
    );
  });

  test("show the shelf gallery layout", async ({
    libraryPage,
    ownShelf,
    request,
  }) => {
    const alpha = await fetchBookUuidByTitle(request, "Alpha");
    const shelf = await ownShelf("E2E Gallery Layout", { book_uuids: [alpha] });

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the gallery and its controls", async () => {
      await libraryPage.assertDisplayed();
      await libraryPage.topNav.assertDisplayed();
      await expect(libraryPage.shelfGallery.root).toBeVisible();
      await expect(libraryPage.shelfGallery.allBooksTile).toBeVisible();
      await expect(libraryPage.shelfGallery.newShelfButton).toBeVisible();
      await expect(libraryPage.galleryShelfTile(shelf.id)).toBeVisible();
    });
  });

  test("keep an empty shelf off the shelves row", async ({
    libraryPage,
    ownShelf,
    request,
  }) => {
    const alpha = await fetchBookUuidByTitle(request, "Alpha");
    const stocked = await ownShelf("E2E Gallery Stocked", {
      book_uuids: [alpha],
    });
    const empty = await ownShelf("E2E Gallery Bare");

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check only the stocked shelf is on the row", async () => {
      await expect(libraryPage.galleryShelfTile(stocked.id)).toBeVisible();
      await expect(libraryPage.galleryShelfTile(empty.id)).toHaveCount(0);
    });
  });

  test.describe("creating", () => {
    test("float the create-shelf modal above the page, not in the book column", async ({
      libraryPage,
      ownShelf,
      request,
    }) => {
      const modal = libraryPage.createShelfModal;
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      await ownShelf("E2E Float", { book_uuids: [alpha] });

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
      ownShelf,
      createdShelfIds,
      expectMutation,
      request,
    }) => {
      const { name } = buildShelf("E2E Picks");
      const modal = libraryPage.createShelfModal;
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      await ownShelf("E2E Picks Row", { book_uuids: [alpha] });

      // A book on it, since the row leaves an empty shelf out.
      await test.step("fill in the New shelf modal", async () => {
        await libraryPage.goto();
        await libraryPage.shelfGallery.openNewShelf();
        await expect(modal.root).toBeVisible();
        await modal.fillHandPickedShelf(name);
        await modal.pickBook("Alpha", alpha);
      });

      const id = await test.step("create the shelf", async () => {
        const { response } = await expectMutation(
          shelves.create({
            kind: "manual",
            name,
            visibility: "private",
            match_mode: null,
            rules: [],
            book_uuids: [alpha],
          }),
          () => modal.create(),
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
      ownShelf,
      expectMutation,
      request,
    }) => {
      const modal = libraryPage.createShelfModal;
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      await ownShelf("E2E Doomed Row", { book_uuids: [alpha] });

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
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Refetch Fail", { book_uuids: [alpha] });

      // Only a forced 500 draws the banner.
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
        await expect(libraryPage.shelfGallery.selectedTab).toContainText(
          shelf.name,
        );
        await expect(libraryPage.pageError).toBeVisible();
        await expect(libraryPage.pageError).toContainText(
          "Couldn't load the library",
        );
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

      // The modal always states the device sync toggle's value for a non-system shelf.
      await test.step("save it", async () => {
        await expectMutation(
          shelves.update(shelf.id, {
            name: shelf.name,
            visibility: "private",
            sync_to_kobo: false,
            match_mode: "any",
            rules: [authorRule("Grace Hopper")],
          }),
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

    test("edit a shelf's name, visibility, and device sync from the pencil modal", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Edit Fields", { book_uuids: [alpha] });
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
        // The device sync opt-in prefills from the shelf: off for a fresh one.
        await expect(editor.koboOffButton).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });

      await test.step("rename it, make it public and turn device sync on", async () => {
        await editor.rename(renamed);
        await editor.makePublic();
        await editor.turnKoboSyncOn();
      });

      // The sync badge lives on the shelf page, so the opt-in is asserted on the wire.
      await test.step("save it", async () => {
        await expectMutation(
          shelves.update(shelf.id, {
            name: renamed,
            visibility: "public",
            sync_to_kobo: true,
          }),
          () => editor.save(),
        );
      });

      await test.step("check the shelf tab shows the edit", async () => {
        await expect(editor.root).not.toBeVisible();
        await expect(libraryPage.shelfGallery.selectedTab).toContainText(
          renamed,
        );
        await expect(libraryPage.shelfFacets).toContainText("Public");
      });
    });

    test("surface an error when the shelf edit save fails", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Edit Fail", { book_uuids: [alpha] });
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

      // The tab keeps the saved name: the failed edit must not leak in.
      await test.step("check the editor says it failed", async () => {
        await expect(editor.errorMessage).toBeVisible();
        await expect(libraryPage.shelfGallery.selectedTab).toContainText(
          shelf.name,
        );
        await expect(libraryPage.shelfGallery.selectedTab).not.toContainText(
          "v2",
        );
      });
    });
  });
});
