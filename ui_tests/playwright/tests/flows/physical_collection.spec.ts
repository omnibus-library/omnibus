import { physical } from "../contracts/physical";
import { SAMPLE_COPY, SAMPLE_WISHLIST_ENTRY } from "../data/physical";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Every physical and wishlist read and write is stubbed, so nothing here
// changes library-wide copies or the admin's wishlist. The target is immaterial,
// but a real uuid exercises the SSR and hydration path the panel loads under.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-island")!;

test.describe("physical collection", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the physical collection layout", async ({
    request,
    bookDetailPage,
  }) => {
    const { wishlist, physicalCopy } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    // Stubbed empty, so ambient copies or wishlist entries can't flake it.
    await test.step("open a book with no copies and no wish", async () => {
      await bookDetailPage.stubPhysicalLoad([], null);
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the hero rail offers the wishlist", async () => {
      await bookDetailPage.assertDisplayed();
      await bookDetailPage.topNav.assertDisplayed();
      await expect(wishlist.addButton).toBeVisible();
    });

    // The copies panel renders nothing at all for a copy-less book.
    await test.step("check there are no copies to show", async () => {
      await expect(bookDetailPage.physicalPill).toBeHidden();
      await expect(physicalCopy.panel).toBeHidden();
    });
  });

  test.describe("wishlist", () => {
    test("add a book to the wishlist", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { wishlist } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book that is not wished for", async () => {
        await bookDetailPage.stubPhysicalLoad([], null);
        await bookDetailPage.goto(uuid);
        await expect(wishlist.addButton).toBeVisible();
      });

      await test.step("add it to the wishlist", async () => {
        await wishlist.stubAdd(SAMPLE_WISHLIST_ENTRY);
        await expectMutation(physical.wishlistAdd(), () => wishlist.add());
      });

      // The cover badge row gains the "Physical Wishlist" facet and the rail
      // slot shows the tracking card, and the More stop's shelf list holds the
      // viewer's Wishlist off the same signal, with no refetch.
      await test.step("check the book shows as wished for", async () => {
        await expect(wishlist.coverBadge).toBeVisible();
        await expect(wishlist.card).toBeVisible();
        await expect(wishlist.findCopyLink).toBeVisible();
        await expect(wishlist.shelfTile).toBeVisible();
      });
    });

    test("remove a book from the wishlist", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { wishlist } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book that is wished for", async () => {
        await bookDetailPage.stubPhysicalLoad([], SAMPLE_WISHLIST_ENTRY);
        await bookDetailPage.goto(uuid);
        await expect(wishlist.card).toBeVisible();
        await expect(wishlist.shelfTile).toBeVisible();
      });

      await test.step("remove it from the wishlist", async () => {
        await wishlist.stubRemove();
        await expectMutation(physical.wishlistRemove(), () =>
          wishlist.remove(),
        );
      });

      await test.step("check the book offers the wishlist again", async () => {
        await expect(wishlist.addButton).toBeVisible();
        // Other shelves (a smart shelf matching the book) may stay.
        await expect(wishlist.shelfTile).toHaveCount(0);
      });
    });

    test("show an error when adding to the wishlist fails", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { wishlist } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book that is not wished for", async () => {
        await bookDetailPage.stubPhysicalLoad([], null);
        await bookDetailPage.goto(uuid);
      });

      await test.step("add it while adds fail", async () => {
        await bookDetailPage.forceServerError(physical.wishlistAdd());
        await expectMutation(failing(physical.wishlistAdd()), () =>
          wishlist.add(),
        );
      });

      // The optimistic state reverted, so the page still offers to add.
      await test.step("check the error shows", async () => {
        await expect(wishlist.errorMessage).toBeVisible();
        await expect(wishlist.addButton).toBeVisible();
      });
    });
  });

  test.describe("copies", () => {
    test("show an error when the copies fail to load", async ({
      request,
      bookDetailPage,
    }) => {
      const { physicalCopy, wishlist } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book while the copies read fails", async () => {
        await bookDetailPage.forceServerError(physical.copies());
        await wishlist.stubLoad(null);
        await bookDetailPage.goto(uuid);
      });

      // A failed read must not masquerade as the empty state.
      await test.step("check the panel shows the error", async () => {
        await expect(physicalCopy.loadError).toBeVisible();
      });
    });

    test("show the physical copy card for a checked-in book", async ({
      request,
      bookDetailPage,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book with one copy", async () => {
        await bookDetailPage.stubPhysicalLoad([SAMPLE_COPY], null);
        await bookDetailPage.goto(uuid);
      });

      // The copies list marks a physical copy with a status dot rather than a
      // text pill, so the wording lives in the accessible name.
      await test.step("check the copy shows", async () => {
        await expect(bookDetailPage.physicalPill).toBeVisible();
        await expect(bookDetailPage.physicalPill).toHaveAttribute(
          "aria-label",
          "In your physical collection",
        );
        await expect(bookDetailPage.physicalCopyCards).toBeVisible();
        await expect(bookDetailPage.physicalCopyCards).toContainText(
          "Trade paperback, MIT Press",
        );
        await expect(bookDetailPage.physicalCopyCards).toContainText(
          "9780262033848",
        );
      });
    });

    test("edit a copy note", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { physicalCopy } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const note = "Hardcover, first printing";

      await test.step("open a book with one copy", async () => {
        await bookDetailPage.stubPhysicalLoad([SAMPLE_COPY], null);
        await bookDetailPage.goto(uuid);
      });

      await test.step("write a new note", async () => {
        await physicalCopy.editNote(note);
      });

      await test.step("save the note", async () => {
        await physicalCopy.stubNoteSave({ ...SAMPLE_COPY, note });
        await expectMutation(physical.copyNote(), () =>
          physicalCopy.saveNote(),
        );
      });

      await test.step("check the card shows the note", async () => {
        await expect(bookDetailPage.physicalCopyCards).toContainText(note);
      });
    });

    test("delete a copy through the sold-it confirm", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { physicalCopy } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book with one copy", async () => {
        await bookDetailPage.stubPhysicalLoad([SAMPLE_COPY], null);
        await bookDetailPage.goto(uuid);
      });

      // A file-backed book, so this is the plain confirm, not the last-copy
      // remove-or-wishlist prompt.
      await test.step("ask to delete the copy", async () => {
        await bookDetailPage.openRemoveCopyDialog();
        await expect(physicalCopy.deleteDialog).toBeVisible();
      });

      await test.step("confirm the delete", async () => {
        await physicalCopy.stubDelete();
        await expectMutation(physical.deleteCopy(), () =>
          physicalCopy.confirmDelete(),
        );
      });

      await test.step("check the copy is gone", async () => {
        await expect(bookDetailPage.physicalCopyCards).toBeHidden();
      });
    });

    // A copy's note and removal belong to whoever filed it or an admin, so a
    // plain reader sees who filed it and nothing to press.
    test("show another reader's copy without controls", async ({
      request,
      readerBookDetailPage,
    }) => {
      const { physicalCopy } = readerBookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book with a copy another reader filed", async () => {
        await readerBookDetailPage.stubPhysicalLoad(
          [{ ...SAMPLE_COPY, added_by_user_id: 424242, added_by_name: "Ada" }],
          null,
        );
        await readerBookDetailPage.goto(uuid);
      });

      await test.step("check the copy names its filer and offers no controls", async () => {
        await expect(readerBookDetailPage.physicalCopyCards).toContainText(
          "by Ada",
        );
        await expect(readerBookDetailPage.physicalCopyCards).toContainText(
          "Trade paperback, MIT Press",
        );
        await expect(physicalCopy.editNoteButton).toHaveCount(0);
        await expect(readerBookDetailPage.removeCopyButton).toHaveCount(0);
      });
    });
  });
});
