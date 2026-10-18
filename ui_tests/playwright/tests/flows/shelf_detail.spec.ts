import { shelves } from "../contracts/shelves";
import { buildShelf, buildShelfUpdate, smartShelfBy } from "../data/shelves";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Writes land on shelves this file made; the fixture books they hold are only read.
test.describe("shelf page", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the shelf layout", async ({ shelfPage, ownShelf, request }) => {
    const alpha = await fetchBookUuidByTitle(request, "Alpha");
    const shelf = await ownShelf("E2E Detail Layout", { book_uuids: [alpha] });

    await test.step("open the shelf from the index", async () => {
      await shelfPage.goto(shelf.id);
    });

    await test.step("check the shelf and its controls", async () => {
      await shelfPage.assertDisplayed();
      await shelfPage.topNav.assertDisplayed();
      await expect(shelfPage.heading(shelf.name)).toBeVisible();
      await expect(shelfPage.kickerText).toContainText("Hand-picked shelf");
      await expect(shelfPage.ownerBadge).toContainText("Your shelf");
      await expect(shelfPage.addBooksButton).toBeEnabled();
      await expect(shelfPage.editButton).toBeEnabled();
      await expect(shelfPage.moreButton).toBeEnabled();
      await expect(shelfPage.lockNote).toHaveCount(0);
      await expect(shelfPage.bookGrid).toContainText("Alpha");
      await expect(shelfPage.backLink).toHaveAttribute("href", "/shelves");
    });
  });

  test("open a book from the shelf", async ({
    shelfPage,
    bookDetailPage,
    ownShelf,
    request,
  }) => {
    const alpha = await fetchBookUuidByTitle(request, "Alpha");
    const shelf = await ownShelf("E2E Detail Book", { book_uuids: [alpha] });

    await test.step("open the shelf from the index", async () => {
      await shelfPage.goto(shelf.id);
    });

    await test.step("open the book", async () => {
      await shelfPage.openBook("Alpha");
    });

    await test.step("check the book page shows", async () => {
      await bookDetailPage.assertDisplayedFor(alpha);
    });
  });

  test.describe("membership", () => {
    test("add a book to a hand-picked shelf", async ({
      shelfPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Detail Add");
      const picker = shelfPage.addBooksModal;

      await test.step("open the empty shelf", async () => {
        await shelfPage.goto(shelf.id);
        await expect(shelfPage.emptyMessage).toContainText(
          "No books on this shelf yet.",
        );
      });

      await test.step("open the picker", async () => {
        await shelfPage.openAddBooks();
        await expect(picker.heading(shelf.name)).toBeVisible();
        await expect(picker.submitButton).toBeDisabled();
      });

      await test.step("pick a book", async () => {
        await picker.search("Alpha");
        await expect(picker.tile(alpha)).toContainText("Alpha");
        // A <button> shrink-wraps, so a tile can take a click and render as nothing.
        await expect.poll(() => picker.tileWidth(alpha)).toBeGreaterThan(40);
        await picker.pick(alpha);
        await expect(picker.tile(alpha)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(picker.submitButton).toHaveText("Add 1 book");
      });

      await test.step("add it", async () => {
        await expectMutation(shelves.addBooks(shelf.id, [alpha]), () =>
          picker.submit(),
        );
      });

      await test.step("check the shelf lists it", async () => {
        await expect(picker.root).toHaveCount(0);
        await expect(shelfPage.bookGrid).toContainText("Alpha");
      });
    });

    test("keep the picker open and say so when adding fails", async ({
      shelfPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Detail Add Fail");
      const picker = shelfPage.addBooksModal;

      await test.step("pick a book in the picker", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.forceServerError(shelves.addBooks());
        await shelfPage.openAddBooks();
        await picker.search("Alpha");
        await picker.pick(alpha);
      });

      await test.step("add it", async () => {
        await expectMutation(failing(shelves.addBooks()), () =>
          picker.submit(),
        );
      });

      await test.step("check the picker says it failed", async () => {
        await expect(picker.errorMessage).toBeVisible();
        await expect(picker.root).toBeVisible();
      });
    });

    test("mark a book already on the shelf instead of offering it again", async ({
      shelfPage,
      ownShelf,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Detail Member", {
        book_uuids: [alpha],
      });
      const picker = shelfPage.addBooksModal;

      await test.step("search the picker for the member", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.openAddBooks();
        await picker.search("Alpha");
      });

      await test.step("check the member is marked and disabled", async () => {
        await expect(picker.tile(alpha)).toContainText("On this shelf");
        await expect(picker.tile(alpha)).toBeDisabled();
      });

      // Inert, not merely styled: a member can't be picked into a second copy.
      await test.step("press the member anyway", async () => {
        await picker.pickAnyway(alpha);
        await expect(picker.submitButton).toHaveText("Add books");
        await expect(picker.submitButton).toBeDisabled();
      });
    });

    test("keep Add books unavailable until the member list has loaded", async ({
      shelfPage,
      ownShelf,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Detail Members Unknown", {
        book_uuids: [alpha],
      });

      // A failed fetch clears the page's books, so an ungated picker would offer members.
      await test.step("fail the member fetch and open the shelf", async () => {
        await shelfPage.forceServerError(shelves.page());
        await shelfPage.goto(shelf.id);
      });

      await test.step("check Add books is inert", async () => {
        await expect(shelfPage.addBooksButton).toBeDisabled();
        await shelfPage.openAddBooksAnyway();
        await expect(shelfPage.addBooksModal.root).toHaveCount(0);
      });
    });

    test("take a book off a hand-picked shelf", async ({
      shelfPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Detail Remove", {
        book_uuids: [alpha],
      });

      await test.step("open the shelf", async () => {
        await shelfPage.goto(shelf.id);
        await expect(shelfPage.bookGrid).toContainText("Alpha");
      });

      await test.step("take the book off", async () => {
        await expectMutation(shelves.removeBook(shelf.id, alpha), () =>
          shelfPage.removeBook("Alpha"),
        );
      });

      await test.step("check the shelf is empty", async () => {
        await expect(shelfPage.emptyMessage).toBeVisible();
      });
    });

    test("keep the book and say so when taking it off fails", async ({
      shelfPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Detail Remove Fail", {
        book_uuids: [alpha],
      });

      await test.step("open the shelf", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.forceServerError(shelves.removeBook());
      });

      await test.step("take the book off", async () => {
        await expectMutation(failing(shelves.removeBook()), () =>
          shelfPage.removeBook("Alpha"),
        );
      });

      await test.step("check the shelf says it failed", async () => {
        await expect(shelfPage.removeError).toContainText(
          "Couldn’t remove “Alpha”",
        );
        await expect(shelfPage.bookGrid).toContainText("Alpha");
      });
    });
  });

  test.describe("editing", () => {
    test("rename a shelf from Edit shelf", async ({
      shelfPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Detail Rename");
      const renamed = `${shelf.name} (renamed)`;
      const editor = shelfPage.editShelfModal;

      await test.step("rename it in the editor", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.openEditShelf();
        await editor.rename(renamed);
      });

      await test.step("save it", async () => {
        await expectMutation(shelves.update(), () => editor.save());
      });

      await test.step("check the title changed", async () => {
        await expect(editor.root).toHaveCount(0);
        await expect(shelfPage.heading(renamed)).toBeVisible();
      });
    });

    test("keep the name and say so when a rename fails", async ({
      shelfPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Detail Rename Fail");
      const editor = shelfPage.editShelfModal;

      await test.step("rename it in the editor", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.forceServerError(shelves.update());
        await shelfPage.openEditShelf();
        await editor.rename(`${shelf.name} v2`);
      });

      await test.step("save it", async () => {
        await expectMutation(failing(shelves.update()), () => editor.save());
      });

      await test.step("check the editor says it failed", async () => {
        await expect(editor.errorMessage).toBeVisible();
        await expect(shelfPage.heading(shelf.name)).toBeVisible();
      });
    });

    test("turn on Kobo sync from the More menu", async ({
      shelfPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Detail Kobo");

      await test.step("open the More menu", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.openMenu();
        await expect(shelfPage.koboSyncToggle).toHaveAttribute(
          "aria-checked",
          "false",
        );
      });

      await test.step("turn Sync to Kobo on", async () => {
        await expectMutation(
          shelves.update(shelf.id, buildShelfUpdate({ sync_to_kobo: true })),
          () => shelfPage.toggleKoboSync(),
        );
      });

      await test.step("check the shelf wears the Kobo badge", async () => {
        await expect(shelfPage.koboBadge).toBeVisible();
      });
    });

    test("delete a shelf and return to the index", async ({
      shelfPage,
      shelvesIndexPage,
      shelvesRequests,
      createdShelfIds,
      expectMutation,
    }) => {
      const id = await test.step("create a shelf through the api", async () => {
        const created = await shelvesRequests.postShelf(
          buildShelf("E2E Detail Delete"),
        );
        await expect(created).toBeOK();
        const { id }: { id: number } = await created.json();
        createdShelfIds.add(id);
        return id;
      });

      await test.step("ask to delete it", async () => {
        await shelfPage.goto(id);
        await shelfPage.openDeleteDialog();
        await expect(shelfPage.deleteDialog).toBeVisible();
      });

      await test.step("confirm", async () => {
        await expectMutation(shelves.delete(id), () =>
          shelfPage.confirmDelete(),
        );
        createdShelfIds.delete(id);
      });

      await test.step("check the index no longer lists it", async () => {
        await shelvesIndexPage.assertDisplayed();
        await expect(shelvesIndexPage.shelfCard(id)).toHaveCount(0);
      });
    });

    test("keep the shelf and say so when deleting fails", async ({
      shelfPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Detail Delete Fail");

      await test.step("ask to delete it", async () => {
        await shelfPage.goto(shelf.id);
        await shelfPage.forceServerError(shelves.delete());
        await shelfPage.openDeleteDialog();
      });

      await test.step("confirm", async () => {
        await expectMutation(failing(shelves.delete()), () =>
          shelfPage.confirmDelete(),
        );
      });

      await test.step("check the dialog says it failed", async () => {
        await expect(shelfPage.deleteError).toBeVisible();
        await expect(shelfPage.deleteConfirmButton).toBeEnabled();
        await shelfPage.assertDisplayedFor(shelf.id);
      });
    });
  });

  test.describe("smart shelves", () => {
    // "Ada Lovelace" matches the Alpha fixtures, which are read and never written.
    const ada = smartShelfBy("Ada Lovelace");

    test("show a smart shelf's rules", async ({ shelfPage, ownShelf }) => {
      const shelf = await ownShelf("E2E Detail Smart", ada);

      await test.step("open the shelf", async () => {
        await shelfPage.goto(shelf.id);
      });

      await test.step("check its rules and members", async () => {
        await expect(shelfPage.rulesSummary).toContainText(
          "Author is Ada Lovelace",
        );
        // Rules fill a smart shelf, so there is nothing to add by hand.
        await expect(shelfPage.addBooksButton).toHaveCount(0);
        await expect(shelfPage.bookGrid).toContainText("Alpha");
      });
    });

    test("re-sort a smart shelf's books", async ({
      shelfPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Detail Sort", ada);

      await test.step("open the shelf", async () => {
        await shelfPage.goto(shelf.id);
      });

      await test.step("sort by title", async () => {
        await expectMutation(shelves.page(), () => shelfPage.sortBy("title"));
      });

      await test.step("check the members still list", async () => {
        await expect(shelfPage.bookGrid).toContainText("Alpha");
      });
    });
  });

  // The admin may change every shelf but a Wishlist; the other locks are a reader's view.
  test.describe("access", () => {
    test("grey out every change on a Wishlist and say why", async ({
      shelfPage,
      adminWishlist,
    }) => {
      await test.step("open the admin's own Wishlist", async () => {
        await shelfPage.goto(adminWishlist.id);
      });

      await test.step("check every change is greyed with a reason", async () => {
        await expect(shelfPage.editButton).toBeDisabled();
        await expect(shelfPage.moreButton).toBeDisabled();
        await expect(shelfPage.addBooksButton).toHaveCount(0);
        await expect(shelfPage.lockNote).toContainText(
          "Your wishlist can’t be edited here.",
        );
        await expect(shelfPage.editButton).toHaveAttribute(
          "aria-describedby",
          "shd-lock-reason",
        );
      });

      // A greyed control is inert, not merely styled.
      await test.step("press Edit shelf anyway", async () => {
        await shelfPage.openEditShelfAnyway();
        await expect(shelfPage.editShelfModal.root).toHaveCount(0);
      });
    });

    test("grey out another reader's shelf and name its owner", async ({
      readerShelfPage,
      ownShelf,
    }) => {
      const shelf = await ownShelf("E2E Detail Locked", {
        visibility: "public",
      });

      await test.step("open the admin's public shelf as a reader", async () => {
        await readerShelfPage.goto(shelf.id);
      });

      await test.step("check every change is greyed", async () => {
        await expect(readerShelfPage.heading(shelf.name)).toBeVisible();
        await expect(readerShelfPage.addBooksButton).toBeDisabled();
        await expect(readerShelfPage.editButton).toBeDisabled();
        await expect(readerShelfPage.moreButton).toBeDisabled();
      });

      await test.step("check the note names the owner", async () => {
        const owner = await readerShelfPage.ownerLabel();
        expect(owner, "the shelf names its owner").toBeTruthy();
        await expect(readerShelfPage.lockNote).toContainText(
          `You can’t edit this shelf — it belongs to ${owner}.`,
        );
      });

      await test.step("press Add books anyway", async () => {
        await readerShelfPage.openAddBooksAnyway();
        await expect(readerShelfPage.addBooksModal.root).toHaveCount(0);
      });
    });

    test("let an admin change another reader's shelf without explaining why", async ({
      shelfPage,
      ownShelf,
      readerAccount,
    }) => {
      const shelf = await ownShelf("E2E Reader Shelf", {}, "reader");

      await test.step("open the reader's shelf as the admin", async () => {
        await shelfPage.goto(shelf.id);
      });

      // The hero still names the owner; only a refusal earns a note.
      await test.step("check the admin may edit with no note", async () => {
        await expect(shelfPage.ownerName).toHaveText(readerAccount.username);
        await expect(shelfPage.adminNote).toHaveCount(0);
        await expect(shelfPage.editButton).toBeEnabled();
        await expect(shelfPage.lockNote).toHaveCount(0);
      });
    });
  });
});
