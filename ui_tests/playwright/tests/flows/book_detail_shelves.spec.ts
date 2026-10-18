import { account } from "../contracts/account";
import { readStatus } from "../contracts/readStatus";
import { shelves } from "../contracts/shelves";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The book page's More stop shows every shelf holding the book as a tile, and
// "Add to shelf" opens a picker that files this book on a hand-picked shelf, or
// takes it off, without leaving the page.
//
// `standalone-forest` is reserved for this spec (see fixtures/epubs.ts). The
// suite is fullyParallel, so each test makes a shelf of its own and asserts only
// about that shelf, never about the book's whole shelf list.

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-forest")!;

// Only read: the series test opens its More stop and writes nothing.
const SERIES_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;

// One unbroken run far wider than a picker tile: it fits only by breaking
// mid-word.
const LONG_SHELF_LABEL = "W".repeat(90);

const NO_SHELF_TEXT = "Not on a shelf yet.";

test.describe("book detail shelves", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the book detail shelves layout", async ({
    request,
    bookDetailPage,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the page and its nav", async () => {
      await bookDetailPage.assertDisplayed();
      await bookDetailPage.topNav.assertDisplayed();
    });

    await test.step("check the More stop and its button", async () => {
      await expect(bookDetailPage.stops.moreStop).toBeAttached();
      await expect(bookDetailPage.addToShelfButton).toBeVisible();
    });
  });

  test("show Add to shelf beneath a series book's own shelf", async ({
    request,
    bookDetailPage,
  }) => {
    const { stops } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, SERIES_BOOK.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // The series shelf already fills the stop, so a book on no shelf gets the
    // button alone rather than a big "Not on a shelf yet." under the covers.
    await test.step("check the button sits beneath the series shelf", async () => {
      await expect(stops.seriesShelf).toBeVisible();
      await expect(bookDetailPage.addToShelfButton).toBeVisible();
      await expect(stops.moreStop).toContainText("On your shelves");
      await expect(stops.moreStop).not.toContainText(NO_SHELF_TEXT);
    });
  });

  test("add a book to a hand-picked shelf", async ({
    request,
    bookDetailPage,
    ownShelf,
    expectMutation,
  }) => {
    const { shelfPicker } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const shelf = await test.step("make an empty hand-picked shelf", () =>
      ownShelf(LONG_SHELF_LABEL));
    const tile = shelfPicker.shelf(shelf.name);
    const onPage = bookDetailPage.shelfTile(shelf.id);

    await test.step("open the picker", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.openShelfPicker();
    });

    await test.step("check it offers the empty shelf", async () => {
      await expect(shelfPicker.heading("Add to shelf")).toBeVisible();
      await expect(tile).not.toBeChecked();
      await expect(tile).toContainText("0 books");
      await expect(onPage).toHaveCount(0);
      await shelfPicker.assertShelfNameFits(shelf.name);
    });

    await test.step("add the book", async () => {
      await expectMutation(shelves.addBooks(shelf.id, [uuid]), () =>
        shelfPicker.toggle(shelf.name),
      );
    });

    await test.step("check the shelf holds the book", async () => {
      await expect(tile).toBeChecked();
      await expect(tile).toContainText("1 book");
      await expect(onPage).toHaveCount(1);
      await expect(onPage).toContainText("1 book");
      await expect(onPage).toContainText("Hand-picked");
      await shelfPicker.assertShelfNameFits(shelf.name);
    });
  });

  test("take a book off a hand-picked shelf", async ({
    request,
    bookDetailPage,
    ownShelf,
    expectMutation,
  }) => {
    const { shelfPicker } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const shelf = await test.step("make a shelf holding the book", () =>
      ownShelf("E2E Book Shelf", { book_uuids: [uuid] }));
    const tile = shelfPicker.shelf(shelf.name);
    const onPage = bookDetailPage.shelfTile(shelf.id);

    await test.step("open the picker", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.openShelfPicker();
    });

    await test.step("check the shelf holds the book", async () => {
      await expect(tile).toBeChecked();
      await expect(tile).toContainText("1 book");
      await expect(onPage).toHaveCount(1);
    });

    await test.step("take the book off", async () => {
      await expectMutation(shelves.removeBook(shelf.id, uuid), () =>
        shelfPicker.toggle(shelf.name),
      );
    });

    await test.step("check the shelf is empty again", async () => {
      await expect(tile).not.toBeChecked();
      await expect(tile).toContainText("0 books");
      await expect(onPage).toHaveCount(0);
    });
  });

  test("show a smart shelf holding the book as a tile and list it as automatic", async ({
    request,
    bookDetailPage,
    ownShelf,
  }) => {
    const { shelfPicker, stops } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    // Henri Poincare wrote no other fixture, so the rule matches this book only.
    const shelf =
      await test.step("make a smart shelf matching the author", () =>
        ownShelf("E2E Rule Shelf", {
          kind: "smart",
          match_mode: "any",
          rules: [{ field: "author", op: "is", value: TARGET.authors[0]! }],
        }));
    const onPage = bookDetailPage.shelfTile(shelf.id);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the shelf shows as a smart tile", async () => {
      await expect(onPage).toContainText(shelf.name);
      await expect(bookDetailPage.shelfTileKind(shelf.id)).toHaveText("Smart");
      await expect(stops.moreStop).not.toContainText(NO_SHELF_TEXT);
    });

    await test.step("open the picker", async () => {
      await bookDetailPage.openShelfPicker();
    });

    await test.step("check the picker lists it as automatic", async () => {
      await expect(shelfPicker.hint).toHaveText(
        "Only shelves you fill by hand are listed; smart shelves add books by their rules.",
      );
      await expect(shelfPicker.automaticShelves).toContainText("Automatic");
      await expect(shelfPicker.automaticShelf(shelf.id)).toContainText(
        shelf.name,
      );
      // A rule fills it, so there is nothing to tick.
      await expect(shelfPicker.shelf(shelf.name)).toHaveCount(0);
    });
  });

  test("list a smart shelf the moment marking the book finished makes it match", async ({
    request,
    bookDetailPage,
    ownShelf,
    startReadStatusAt,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const shelf = await test.step("make a smart shelf of finished books", () =>
      ownShelf("E2E Rule Shelf", {
        kind: "smart",
        match_mode: "any",
        rules: [{ field: "status", op: "is", value: "finished" }],
      }));
    const onPage = bookDetailPage.shelfTile(shelf.id);

    // Read status is per-user and global, and this spec owns the book's.
    await test.step("start the book unread", async () => {
      await startReadStatusAt(uuid, "unread");
    });

    await test.step("open the book and check the shelf is not listed", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.shelvesLoading).toHaveCount(0);
      await expect(onPage).toHaveCount(0);
    });

    await test.step("mark the book finished", async () => {
      await expectMutation(readStatus.set(), () =>
        bookDetailPage.readStatusControl.markFinished(),
      );
    });

    // No reload: the page re-reads which shelves hold the book.
    await test.step("check the shelf is listed", async () => {
      await expect(onPage).toBeVisible();
      await expect(onPage).not.toContainText("0 books");
      await expect(bookDetailPage.stops.moreStop).not.toContainText(
        NO_SHELF_TEXT,
      );
    });
  });

  test("keep the shelf unchanged when the add fails", async ({
    request,
    bookDetailPage,
    ownShelf,
    expectMutation,
  }) => {
    const { shelfPicker } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const shelf = await test.step("make an empty hand-picked shelf", () =>
      ownShelf("E2E Book Shelf"));
    const tile = shelfPicker.shelf(shelf.name);

    await test.step("open the picker", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.openShelfPicker();
    });

    await test.step("add the book while the write fails", async () => {
      const contract = shelves.addBooks(shelf.id, [uuid]);
      await bookDetailPage.forceServerError(contract);
      await expectMutation(failing(contract), () =>
        shelfPicker.toggle(shelf.name),
      );
    });

    await test.step("check the picker reports it and the shelf is unchanged", async () => {
      await expect(shelfPicker.errorMessage).toContainText(shelf.name);
      await expect(shelfPicker.root).toBeVisible();
      await expect(tile).not.toBeChecked();
      await expect(bookDetailPage.shelfTile(shelf.id)).toHaveCount(0);
    });

    // The failure belongs to that visit: a reopened picker starts clean.
    await test.step("reopen the picker and check the error is gone", async () => {
      await shelfPicker.close();
      await expect(shelfPicker.root).toHaveCount(0);
      await bookDetailPage.openShelfPicker();
      await expect(shelfPicker.errorMessage).toHaveCount(0);
    });
  });

  test("keep the shelf unchanged when the remove fails", async ({
    request,
    bookDetailPage,
    ownShelf,
    expectMutation,
  }) => {
    const { shelfPicker } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const shelf = await test.step("make a shelf holding the book", () =>
      ownShelf("E2E Book Shelf", { book_uuids: [uuid] }));
    const tile = shelfPicker.shelf(shelf.name);

    await test.step("open the picker", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.openShelfPicker();
      await expect(tile).toBeChecked();
    });

    await test.step("take the book off while the write fails", async () => {
      const contract = shelves.removeBook(shelf.id, uuid);
      await bookDetailPage.forceServerError(contract);
      await expectMutation(failing(contract), () =>
        shelfPicker.toggle(shelf.name),
      );
    });

    await test.step("check the picker reports it and the shelf is unchanged", async () => {
      await expect(shelfPicker.errorMessage).toContainText(shelf.name);
      await expect(tile).toBeChecked();
      await expect(bookDetailPage.shelfTile(shelf.id)).toBeVisible();
    });
  });

  test.describe("the picker overlay", () => {
    // The overlay is `position: fixed`; an ancestor with a transform would pin
    // it inside the More stop instead of over the page.
    test("open the picker over the whole window", async ({
      request,
      bookDetailPage,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the picker", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openShelfPicker();
      });

      await test.step("check it covers the window", async () => {
        await expect
          .poll(() => bookDetailPage.shelfPicker.spansWindow())
          .toBe(true);
      });
    });

    test("dismiss the picker with Escape", async ({
      request,
      bookDetailPage,
    }) => {
      const { shelfPicker } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      // Escape is handled on the dialog, which takes focus after it paints.
      await test.step("open the picker and wait for its focus", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openShelfPicker();
        await expect(shelfPicker.dialog).toBeFocused();
      });

      await test.step("press Escape", async () => {
        await shelfPicker.dismissWithEscape();
      });

      await test.step("check the picker closed", async () => {
        await expect(shelfPicker.root).toHaveCount(0);
      });
    });

    test("dismiss the picker with its close button", async ({
      request,
      bookDetailPage,
    }) => {
      const { shelfPicker } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the picker", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openShelfPicker();
      });

      await test.step("click the close button", async () => {
        await shelfPicker.close();
      });

      await test.step("check the picker closed", async () => {
        await expect(shelfPicker.root).toHaveCount(0);
      });
    });

    test("dismiss the picker from the backdrop", async ({
      request,
      bookDetailPage,
    }) => {
      const { shelfPicker } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the picker", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openShelfPicker();
      });

      await test.step("click the backdrop", async () => {
        await shelfPicker.dismissByBackdrop();
      });

      await test.step("check the picker closed", async () => {
        await expect(shelfPicker.root).toHaveCount(0);
      });
    });
  });

  test("open the picker over the whole window when the page snaps between stops", async ({
    request,
    readerSettingsPage,
    readerBookDetailPage,
    readerExpectMutation,
    setScrollStops,
  }) => {
    const { stops, shelfPicker } = readerBookDetailPage;
    const { scrollStopsSwitch } = readerSettingsPage.account;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("turn scroll stops on", async () => {
      await setScrollStops(false, "reader");
      await readerSettingsPage.goto("account");
      await expect(scrollStopsSwitch).toBeEnabled();
      await readerExpectMutation(account.scrollStops(true), () =>
        readerSettingsPage.account.toggleScrollStops(),
      );
      await expect(scrollStopsSwitch).toBeChecked();
    });

    await test.step("open the book and jump to the last stop", async () => {
      await readerBookDetailPage.goto(uuid);
      // The mode is only known once the viewer resolves, so wait for the swap.
      await expect(stops.snap).toBeAttached();
      await stops.jumpTo(5);
      await expect(stops.dot(5)).toHaveClass(/\bon\b/);
    });

    await test.step("open the picker", async () => {
      await readerBookDetailPage.openShelfPicker();
    });

    // A filter on the panel would make it the overlay's containing block and
    // pin the scrim to the panel's 57% rather than the window.
    await test.step("check the picker covers the window", async () => {
      await expect.poll(() => shelfPicker.spansWindow()).toBe(true);
    });

    // The section label and next cue sit above the panel's stacking layer, so
    // they would paint over the scrim and take clicks meant for the backdrop.
    await test.step("check the stop's chrome sits under the scrim", async () => {
      await expect(stops.sectionLabel(5)).toHaveCSS("pointer-events", "none");
      await expect(stops.sectionLabel(5)).toHaveCSS("opacity", "0");
      await expect(stops.nextCue(4)).toHaveCSS("opacity", "0");
    });
  });

  test("hide the back-to-the-book pill while the picker is open", async ({
    request,
    readerSettingsPage,
    readerBookDetailPage,
  }) => {
    const { stops } = readerBookDetailPage;
    const { scrollStopsSwitch } = readerSettingsPage.account;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("check scroll stops are off", async () => {
      await readerSettingsPage.goto("account");
      await expect(scrollStopsSwitch).toBeEnabled();
      await expect(scrollStopsSwitch).not.toBeChecked();
    });

    await test.step("open the book and jump to the last stop", async () => {
      await readerBookDetailPage.goto(uuid);
      await expect(stops.flow).toBeAttached();
      await stops.jumpTo(5);
      await expect(stops.flowTopPill).toHaveClass(/\bon\b/);
    });

    await test.step("open the picker", async () => {
      await readerBookDetailPage.openShelfPicker();
    });

    // The pill sits above the scrim, so it must not stay clickable through it.
    await test.step("check the pill is out of reach", async () => {
      await expect(stops.flowTopPill).toHaveCSS("pointer-events", "none");
      await expect(stops.flowTopPill).toHaveCSS("opacity", "0");
    });
  });
});
