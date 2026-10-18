import { shelves } from "../contracts/shelves";
import { authorRule, buildShelfUpdate, smartShelfBy } from "../data/shelves";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Alpha and Beta are only read: they join shelves made here.
test.describe("shelf gallery", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test.describe("selecting", () => {
    test("select a shelf in place: the glow moves, the list filters, the URL stays put", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Gallery", { book_uuids: [alpha] });
      const gallery = libraryPage.shelfGallery;
      const tile = libraryPage.galleryShelfTile(shelf.id);

      await test.step("open the library as a table", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await expect(gallery.allBooksTile).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(tile).toBeVisible();
      });

      // The member fetch is a server-fn POST, so awaiting it lands the list swap.
      await test.step("select the shelf", async () => {
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
      });

      await test.step("check the glow moved and the list filtered", async () => {
        await expect(tile).toHaveAttribute("aria-pressed", "true");
        await expect(gallery.allBooksTile).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        await expect(libraryPage.sectionTitle).toContainText(shelf.name);
        // The count comes from the member list the grid renders, never a stale aggregate (#2255).
        await expect(libraryPage.sectionTitle).toContainText(/\b1 book\b/);
        await expect(libraryPage.table.rows).toHaveCount(1);
        await expect(libraryPage.table.root).toContainText("Alpha");
        await libraryPage.assertDisplayed();
      });
    });

    test("persist the selected shelf across a reload", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Gallery Persist", {
        book_uuids: [alpha],
      });
      const tile = libraryPage.galleryShelfTile(shelf.id);

      await test.step("select the shelf", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
        await expect(tile).toHaveAttribute("aria-pressed", "true");
      });

      // The saved pick reconciles after mount (rule 07) and refires the member fetch.
      await test.step("reload the library", async () => {
        await expectMutation(shelves.page(), () => libraryPage.reload());
      });

      await test.step("check the shelf is still selected", async () => {
        await expect(tile).toHaveAttribute("aria-pressed", "true");
        await expect(libraryPage.sectionTitle).toContainText(shelf.name);
        await expect(libraryPage.table.rows).toHaveCount(1);
      });
    });

    test("return to All Books and restore the full library", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Gallery Back", {
        book_uuids: [alpha],
      });

      await test.step("select the shelf", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
        await expect(libraryPage.table.rows).toHaveCount(1);
      });

      await test.step("select All Books", async () => {
        await libraryPage.shelfGallery.selectAllBooks();
      });

      await test.step("check the full library is back", async () => {
        await expect(libraryPage.shelfGallery.allBooksTile).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(libraryPage.sectionTitle).toContainText("All Books");
        await expect
          .poll(() => libraryPage.table.rows.count())
          .toBeGreaterThanOrEqual(FIXTURE_BOOKS.length);
      });
    });

    // The wording must not claim a format the shelf isn't restricted to (#2253).
    test("say an empty shelf is empty, not that a search found nothing", async ({
      libraryPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf("E2E Gallery Empty");

      await test.step("select the empty shelf", async () => {
        await libraryPage.goto();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
      });

      await test.step("check the library says the shelf is empty", async () => {
        await expect(libraryPage.sectionTitle).toContainText(shelf.name);
        await expect(libraryPage.sectionTitle).toContainText(/\b0 books\b/);
        await expect(libraryPage.emptyMessage).toHaveText(
          "No books in this shelf.",
        );
        await expect(libraryPage.pageError).toHaveCount(0);
      });
    });
  });

  test.describe("adding books", () => {
    test("add books to a hand-picked shelf from the landing header", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Gallery Add");
      const picker = libraryPage.addBooksModal;

      await test.step("select the empty shelf", async () => {
        await libraryPage.goto();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
        await expect(libraryPage.emptyMessage).toBeVisible();
      });

      // The button is aria-disabled until the members are known, which the click waits out.
      await test.step("pick a book in the picker", async () => {
        await libraryPage.openAddBooks();
        await expect(picker.heading(shelf.name)).toBeVisible();
        await picker.search("Alpha");
        await picker.pick(alpha);
      });

      await test.step("add it", async () => {
        await expectMutation(shelves.addBooks(shelf.id, [alpha]), () =>
          picker.submit(),
        );
      });

      await test.step("check the shelf lists it", async () => {
        await expect(picker.root).toHaveCount(0);
        await expect(libraryPage.bookTile("Alpha")).toBeVisible();
        await expect(libraryPage.sectionTitle).toContainText(/\b1 book\b/);
      });
    });

    test("keep the shelf unchanged when adding books from the landing header fails", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const shelf = await ownShelf("E2E Gallery Add Fail");
      const picker = libraryPage.addBooksModal;

      await test.step("pick a book in the picker", async () => {
        await libraryPage.goto();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
        await expect(libraryPage.emptyMessage).toBeVisible();
        await libraryPage.openAddBooks();
        await picker.search("Alpha");
        await picker.pick(alpha);
      });

      await test.step("add it", async () => {
        await libraryPage.forceServerError(shelves.addBooks());
        await expectMutation(failing(shelves.addBooks(shelf.id, [alpha])), () =>
          picker.submit(),
        );
      });

      // The modal keeps the pick and says why; the shelf behind it is still empty.
      await test.step("check the picker says it failed", async () => {
        await expect(picker.errorMessage).toBeVisible();
        await expect(picker.root).toBeVisible();
      });

      await test.step("close the picker", async () => {
        await picker.close();
      });

      await test.step("check the shelf is still empty", async () => {
        await expect(picker.root).toHaveCount(0);
        await expect(libraryPage.emptyMessage).toBeVisible();
        await expect(libraryPage.sectionTitle).toContainText(/\b0 books\b/);
      });
    });

    test("add books from the tile that closes a hand-picked shelf's grid", async ({
      libraryPage,
      ownShelf,
      expectMutation,
      request,
    }) => {
      const alpha = await fetchBookUuidByTitle(request, "Alpha");
      const beta = await fetchBookUuidByTitle(request, "Beta in the Series");
      const shelf = await ownShelf("E2E Gallery Add Tile", {
        book_uuids: [beta],
      });
      const picker = libraryPage.addBooksModal;

      await test.step("select the shelf", async () => {
        await libraryPage.goto();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
      });

      await test.step("check the Add books tile closes the grid", async () => {
        await expect(libraryPage.lastBookGridItem).toHaveAttribute(
          "data-testid",
          "shelf-add-tile",
        );
      });

      await test.step("open the picker from the tile", async () => {
        await libraryPage.openAddBooksFromTile();
        // The same picker, already knowing what the shelf holds.
        await expect(picker.heading(shelf.name)).toBeVisible();
        await picker.search("Beta");
        await expect(picker.tile(beta)).toContainText("On this shelf");
        await picker.search("Alpha");
        await picker.pick(alpha);
      });

      const release =
        await test.step("add a book while the member refetch is held", async () => {
          const release = await libraryPage.filterBar.holdShelfReads();
          await expectMutation(shelves.addBooks(shelf.id, [alpha]), () =>
            picker.submit(),
          );
          return release;
        });

      // The grid keeps its books, but the stale list can't feed the picker.
      await test.step("check Add books waits for the refetch", async () => {
        await expect(picker.root).toHaveCount(0);
        await expect(libraryPage.bookTile("Beta in the Series")).toBeVisible();
        await expect(libraryPage.loading).toHaveCount(0);
        await expect(libraryPage.shelfAddBooksButton).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        await expect(libraryPage.shelfAddBooksTile).toHaveCount(0);
      });

      await test.step("release the refetch", async () => {
        await release();
      });

      await test.step("check the grid lists both books and the tile is back", async () => {
        await expect(libraryPage.bookTile("Alpha")).toBeVisible();
        await expect(libraryPage.bookTile("Beta in the Series")).toBeVisible();
        await expect(libraryPage.shelfAddBooksButton).toHaveAttribute(
          "aria-disabled",
          "false",
        );
        await expect(libraryPage.lastBookGridItem).toHaveAttribute(
          "data-testid",
          "shelf-add-tile",
        );
      });
    });
  });

  test.describe("editing", () => {
    // The author rule only reads fixture books, so nothing here mutates one.
    test("edit the selected shelf from the landing header pencil", async ({
      libraryPage,
      ownShelf,
      expectMutation,
    }) => {
      const shelf = await ownShelf(
        "E2E Gallery Edit",
        smartShelfBy("Ada Lovelace"),
      );
      const renamed = `${shelf.name} v2`;
      const editor = libraryPage.editShelfModal;

      // The facet row states the kind, visibility and rule once the full shelf lands.
      await test.step("select the shelf", async () => {
        await libraryPage.goto();
        await expectMutation(shelves.page(), () =>
          libraryPage.selectShelf(shelf),
        );
        await expect(libraryPage.shelfFacets).toContainText("Smart shelf");
        await expect(libraryPage.shelfFacets).toContainText("Private");
        await expect(libraryPage.shelfFacets).toContainText(
          "Author is Ada Lovelace",
        );
      });

      await test.step("rename it and make it public in the editor", async () => {
        await libraryPage.openEditShelf();
        await expect(editor.nameField).toHaveValue(shelf.name);
        await editor.rename(renamed);
        await editor.makePublic();
      });

      await test.step("save it", async () => {
        await expectMutation(
          shelves.update(
            shelf.id,
            buildShelfUpdate({
              name: renamed,
              visibility: "public",
              match_mode: "any",
              rules: [authorRule("Ada Lovelace")],
            }),
          ),
          () => editor.save(),
        );
      });

      await test.step("check the header shows the edit", async () => {
        await expect(editor.root).not.toBeVisible();
        await expect(libraryPage.sectionTitle).toContainText(renamed);
        await expect(libraryPage.shelfFacets).toContainText("Public");
        // A smart shelf's members come from its rules, so nothing offers to add.
        await expect(libraryPage.shelfAddBooksButton).toHaveCount(0);
      });
    });
  });

  test.describe("shelves row", () => {
    test("page the shelves row and arm only the end with more", async ({
      libraryPage,
      ownShelf,
    }) => {
      const gallery = libraryPage.shelfGallery;

      // Enough shelves to overflow the row at any sane viewport.
      await test.step("make shelves enough to overflow the row", async () => {
        for (let shelf = 0; shelf < 8; shelf++) {
          await ownShelf(`E2E Paging ${shelf}`);
        }
        await libraryPage.goto();
      });

      // `marquee.js` toggles the `on` class and the tabindex together.
      await test.step("check only the forward arrow is armed", async () => {
        await expect(gallery.nextArrow).toHaveClass(/\bon\b/);
        await expect(gallery.previousArrow).not.toHaveClass(/\bon\b/);
        await expect(gallery.previousArrow).toHaveAttribute("tabindex", "-1");
      });

      // The nudge is a smooth scroll, so poll rather than read the click's frame.
      await test.step("page forward", async () => {
        await gallery.pageForward();
        await expect
          .poll(() => gallery.scrollLeft(), { timeout: 5_000 })
          .toBeGreaterThan(0);
        await expect(gallery.previousArrow).toHaveClass(/\bon\b/);
        await expect(gallery.previousArrow).toHaveAttribute("tabindex", "0");
      });

      // The row snaps: a plain `scrollBy` back once settled on the first shelf, All Books' width short.
      await test.step("page back to the start", async () => {
        await gallery.pageBack();
        await expect
          .poll(() => gallery.scrollLeft(), { timeout: 5_000 })
          .toBe(0);
        await expect(gallery.previousArrow).not.toHaveClass(/\bon\b/);
      });
    });
  });

  // `standalone-island` and `standalone-garden` are reserved: the fan needs both at once.
  test.describe("continue-reading stack", () => {
    // `standalone-mountain` is reserved: Alpha is merged by merge.spec mid-suite.
    test("show the continue-reading stack once a book has progress", async ({
      libraryPage,
      seedResumePoint,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, "Berg der Beweise");
      const stack = libraryPage.continueStack;

      await test.step("put the book on the stack", async () => {
        await libraryPage.assertResumeCardOnStack(uuid, seedResumePoint);
      });

      // A real href on every card keeps middle-click and open-in-new-tab working.
      await test.step("check the stack shows the book's resume card", async () => {
        await expect(stack.root).toBeVisible();
        await expect(stack.card(uuid)).toBeVisible();
        await expect(stack.card(uuid)).toHaveAttribute("href", `/read/${uuid}`);
      });
    });

    // `standalone-desert` is reserved: finishing a book is global state.
    test("drop a book from the continue-reading stack once it is finished", async ({
      libraryPage,
      presetReadStatus,
      readStatusRequests,
      seedResumePoint,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, "Desert Protocols");
      const stack = libraryPage.continueStack;

      // Reset first: this test ends finished, and that outlives the run.
      await test.step("put a reading book on the stack", async () => {
        await presetReadStatus(uuid, "reading");
        await libraryPage.assertResumeCardOnStack(uuid, seedResumePoint);
        await expect(stack.card(uuid)).toBeVisible();
      });

      await test.step("finish the book", async () => {
        const finished = await readStatusRequests.putReadStatus(
          uuid,
          "finished",
        );
        await expect(finished).toBeOK();
      });

      // The stack hides itself when empty, so the page is anchored on the section title.
      await test.step("check the reopened library no longer stacks it", async () => {
        await libraryPage.goto();
        await expect(libraryPage.sectionTitle).toBeVisible();
        await expect(stack.card(uuid)).toBeHidden();
      });
    });

    test("bring a book behind the front one forward instead of navigating", async ({
      libraryPage,
      seedResumePoint,
      request,
    }) => {
      const island = await fetchBookUuidByTitle(
        request,
        "The Isle of Functions",
      );
      const garden = await fetchBookUuidByTitle(
        request,
        "The Garden of Closures",
      );
      const stack = libraryPage.continueStack;

      await test.step("put two books on the stack", async () => {
        await libraryPage.assertResumeCardOnStack(island, seedResumePoint);
        await libraryPage.assertResumeCardOnStack(garden, seedResumePoint);
        await expect.poll(() => stack.cardCount()).toBeGreaterThan(1);
      });

      // Which book leads follows second-granularity ordering, so read the fan.
      const front = await stack.frontUuid();
      const behind = await stack.behindUuid();

      await test.step("bring the book behind forward", async () => {
        await stack.bringForward(behind);
      });

      await test.step("check it leads and the library did not navigate", async () => {
        await stack.assertLeads(behind, front);
        await libraryPage.assertDisplayed();
      });

      // The veil, the resume verb, travels with the front card.
      await test.step("check the veil moved with it", async () => {
        await expect(stack.veil(behind)).toBeAttached();
        await expect(stack.veil(front)).toHaveCount(0);
      });
    });

    // The fan's arrow-key handler was removed: a card comes forward by click or Enter alone.
    test("ignore the arrow keys on a card behind the front one", async ({
      libraryPage,
      seedResumePoint,
      request,
    }) => {
      const island = await fetchBookUuidByTitle(
        request,
        "The Isle of Functions",
      );
      const garden = await fetchBookUuidByTitle(
        request,
        "The Garden of Closures",
      );
      const stack = libraryPage.continueStack;

      await test.step("put two books on the stack", async () => {
        await libraryPage.assertResumeCardOnStack(island, seedResumePoint);
        await libraryPage.assertResumeCardOnStack(garden, seedResumePoint);
        await expect.poll(() => stack.cardCount()).toBeGreaterThan(1);
      });

      const front = await stack.frontUuid();
      const behind = await stack.behindUuid();

      await test.step("press an arrow key on the card behind", async () => {
        await stack.pressOn(behind, "ArrowRight");
      });

      await test.step("check nothing moved", async () => {
        await stack.assertLeads(front, behind);
      });
    });

    test("bring a card forward with Enter", async ({
      libraryPage,
      seedResumePoint,
      request,
    }) => {
      const island = await fetchBookUuidByTitle(
        request,
        "The Isle of Functions",
      );
      const garden = await fetchBookUuidByTitle(
        request,
        "The Garden of Closures",
      );
      const stack = libraryPage.continueStack;

      await test.step("put two books on the stack", async () => {
        await libraryPage.assertResumeCardOnStack(island, seedResumePoint);
        await libraryPage.assertResumeCardOnStack(garden, seedResumePoint);
        await expect.poll(() => stack.cardCount()).toBeGreaterThan(1);
      });

      const front = await stack.frontUuid();
      const behind = await stack.behindUuid();

      await test.step("press Enter on the card behind", async () => {
        await stack.pressOn(behind, "Enter");
      });

      // Enter still suppresses the link's own navigation.
      await test.step("check it leads and the library did not navigate", async () => {
        await stack.assertLeads(behind, front);
        await libraryPage.assertDisplayed();
      });
    });

    test("keep resume reachable as an edge ribbon once the stack scrolls away", async ({
      libraryPage,
      seedResumePoint,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, "Berg der Beweise");
      const stack = libraryPage.continueStack;

      await test.step("put the book on the stack", async () => {
        await libraryPage.assertResumeCardOnStack(uuid, seedResumePoint);
      });

      // The ribbon is in the DOM from first paint so SSR and hydration agree (rule 07).
      await test.step("check the ribbon waits off-screen", async () => {
        await expect(stack.edgeRibbon).toBeAttached();
        await expect(stack.landingRoot).not.toHaveClass(/lmq--past/);
        await expect(stack.edgeRibbon).toHaveCSS("opacity", "0");
        // A `:not()` without its `:where()` wrapper would drop the ribbon into the flow.
        await expect(stack.edgeRibbon).toHaveCSS("position", "fixed");
      });

      await test.step("scroll the stack away", async () => {
        await stack.scrollAway();
        await expect(stack.landingRoot).toHaveClass(/lmq--past/);
        await expect(stack.edgeRibbon).toHaveCSS("opacity", "1");
      });

      // Widening on hover is what exposes the control; the collapsed strip is a marker.
      await test.step("widen the ribbon", async () => {
        await stack.hoverEdgeRibbon();
        await expect(stack.edgeRibbonGo(uuid)).toBeVisible();
      });

      await test.step("scroll back to the stack", async () => {
        await stack.scrollBackToTop();
        await expect(stack.landingRoot).not.toHaveClass(/lmq--past/);
      });
    });
  });
});
