import { ebooks } from "../contracts/ebooks";
import {
  filteredShelfRead,
  shelves,
  unfilteredShelfRead,
} from "../contracts/shelves";
import {
  clauses,
  FILTER_SHELF_SLUGS,
  FILTERED_AUTHORS,
  hasFormat,
  slugsWhere,
  titlesOf,
} from "../data/libraryFilters";
import { AUDIOBOOK_BOOKS } from "../fixtures/audiobooks";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The filter on a selected shelf and on `/shelves/:id`, which share the filter
// the landing saved. Shelf state is server state, so these run as the worker
// reader with the hand-picked `filterShelf` only that reader owns.

test.describe("library filters", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    // The expected sets come from the ebook fixtures alone.
    for (const audiobook of AUDIOBOOK_BOOKS) {
      expect(
        FILTERED_AUTHORS,
        `${audiobook.title} shares an author`,
      ).not.toContain(audiobook.author);
    }
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test.describe("on a shelf", () => {
    test("narrow a selected shelf on the landing page", async ({
      readerLibraryPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar, addBooksModal } = readerLibraryPage;

      await test.step("open the library and select the shelf", async () => {
        await readerLibraryPage.goto();
        await readerLibraryPage.selectShelf(filterShelf);
        await readerLibraryPage.assertShowsBooks(FILTER_SHELF_SLUGS, {
          filtered: false,
        });
      });

      const { request } = await test.step("filter it to Monica Lam", () =>
        readerExpectMutation(shelves.page(), () =>
          filterBar.addClause(clauses.includeLam),
        ));

      await test.step("check the shelf's members narrowed", async () => {
        expect(request.postDataJSON()).toMatchObject({
          id: filterShelf.id,
          filters: {
            clauses: [
              { field: "author", mode: "include", values: ["Monica Lam"] },
            ],
          },
        });
        await readerLibraryPage.assertShowsBooks(["compiler-compendium-2"]);
      });

      // Narrowing must not shrink what Add books treats as already on the shelf.
      await test.step("check Add books still sees the ruled-out member", async () => {
        await readerLibraryPage.openAddBooks();
        await addBooksModal.search("Compendium of Compilers");
        await expect(
          addBooksModal.tile(filterShelf.memberUuid("compiler-compendium-1")),
        ).toContainText("On this shelf");
      });
    });

    test("narrow a shelf on its own page", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerShelfPage;

      await test.step("filter All Books to EPUBs", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includeEpub),
        );
      });

      // The filter set on All Books is the one this page reads.
      await test.step("open the shelf and check it read that filter", async () => {
        await readerShelfPage.goto(filterShelf.id);
        await expect(filterBar.facet("format")).toHaveAccessibleName(
          "Format EPUB",
        );
        await readerShelfPage.assertShowsMembers(
          titlesOf([
            "compiler-compendium-1",
            "compiler-compendium-2",
            "compiler-compendium-3",
          ]),
        );
      });

      const { request } =
        await test.step("exclude Sethi on the shelf page", () =>
          readerExpectMutation(shelves.page(), () =>
            filterBar.addClause(clauses.excludeSethi),
          ));

      await test.step("check the members narrowed again", async () => {
        expect(request.postDataJSON()).toMatchObject({
          id: filterShelf.id,
          filters: {
            clauses: [
              { field: "format", mode: "include", values: ["epub"] },
              { field: "author", mode: "exclude", values: ["Ravi Sethi"] },
            ],
          },
        });
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-1", "compiler-compendium-2"]),
        );
      });

      // Saved where the landing page reads it: both survive a reload, and All
      // Books shows the same two facets.
      await test.step("reload and check both clauses survive", async () => {
        await readerShelfPage.reload();
        await expect(filterBar.facetClearButtons).toHaveCount(2);
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-1", "compiler-compendium-2"]),
        );
      });

      await test.step("check All Books shows the same two facets", async () => {
        await readerLibraryPage.goto();
        await expect(readerLibraryPage.filterBar.facetClearButtons).toHaveCount(
          2,
        );
        await expect(
          readerLibraryPage.filterBar.facet("author"),
        ).toHaveAccessibleName("Author not Ravi Sethi");
      });
    });

    test.describe("a filter that rules out every member", () => {
      test.beforeEach(
        "filter the shelf to Lam, then to PDFs",
        async ({
          readerLibraryPage,
          readerShelfPage,
          readerExpectMutation,
          filterShelf,
        }) => {
          await readerLibraryPage.goto();
          await readerExpectMutation(ebooks.page(), () =>
            readerLibraryPage.filterBar.addClause(clauses.includeLam),
          );
          await readerShelfPage.goto(filterShelf.id);
          await readerExpectMutation(shelves.page(), () =>
            readerShelfPage.filterBar.addClause(clauses.includePdf),
          );
        },
      );

      test("explain the empty shelf", async ({ readerShelfPage }) => {
        await test.step("check the empty shelf is explained", async () => {
          await expect(readerShelfPage.filteredEmptyMessage).toContainText(
            "No books on this shelf match these filters.",
          );
          await expect(readerShelfPage.emptyMessage).toHaveCount(0);
          await expect(readerShelfPage.count).toHaveText("0");
        });
      });

      // The full member list is already loaded, so clearing asks the server nothing.
      test("bring every member back when the filters are cleared", async ({
        readerShelfPage,
      }) => {
        await test.step("clear the filters", async () => {
          await readerShelfPage.clearFilters();
        });

        await test.step("check every member is back", async () => {
          await expect(readerShelfPage.filterBar.facetClearButtons).toHaveCount(
            0,
          );
          await expect(readerShelfPage.filteredEmptyMessage).toHaveCount(0);
          await readerShelfPage.assertShowsMembers(
            titlesOf(FILTER_SHELF_SLUGS),
          );
        });
      });
    });

    test("keep the filter bar when a shelf's narrowed fetch fails on the landing page", async ({
      readerLibraryPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerLibraryPage;

      await test.step("open the library and select the shelf", async () => {
        await readerLibraryPage.goto();
        await readerLibraryPage.selectShelf(filterShelf);
      });

      await test.step("filter it to Lam while narrowed reads fail", async () => {
        await readerLibraryPage.forceServerErrorWhere(
          shelves.page(),
          filteredShelfRead,
        );
        await readerExpectMutation(failing(shelves.page()), () =>
          filterBar.addClause(clauses.includeLam),
        );
      });

      await test.step("check the error shows and the bar stays", async () => {
        await expect(readerLibraryPage.pageError).toBeVisible();
        await expect(filterBar.facetClearButtons).toHaveCount(1);
      });

      // A filter the server refuses must not trap the reader: the shelf's own
      // members are already loaded, so clearing needs no further request.
      await test.step("clear all", async () => {
        await filterBar.clearAll();
      });

      await test.step("check the shelf's members are back", async () => {
        await expect(readerLibraryPage.pageError).toHaveCount(0);
        await expect(filterBar.facetClearButtons).toHaveCount(0);
        await readerLibraryPage.assertShowsBooks(FILTER_SHELF_SLUGS, {
          filtered: false,
        });
      });
    });

    test("keep the filter bar when a shelf's narrowed fetch fails on its own page", async ({
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerShelfPage;

      await test.step("open the shelf", async () => {
        await readerShelfPage.goto(filterShelf.id);
      });

      await test.step("filter it to Lam while narrowed reads fail", async () => {
        await readerShelfPage.forceServerErrorWhere(
          shelves.page(),
          filteredShelfRead,
        );
        await readerExpectMutation(failing(shelves.page()), () =>
          filterBar.addClause(clauses.includeLam),
        );
      });

      await test.step("check the error shows and the bar stays", async () => {
        await expect(readerShelfPage.refetchError).toBeVisible();
        await expect(filterBar.facetClearButtons).toHaveCount(1);
        // The failed fetch left no rows to count, so no count beats "0".
        await expect(readerShelfPage.count).toHaveCount(0);
        await expect(readerShelfPage.countPending).toHaveCount(0);
      });

      await test.step("clear all", async () => {
        await filterBar.clearAll();
      });

      await test.step("check the shelf's members are back", async () => {
        await expect(readerShelfPage.refetchError).toHaveCount(0);
        await expect(filterBar.facetClearButtons).toHaveCount(0);
        await readerShelfPage.assertShowsMembers(titlesOf(FILTER_SHELF_SLUGS));
      });
    });

    test("do not call a shelf empty on its own page while a changed filter is out", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerShelfPage;

      await test.step("filter All Books to Lam PDFs, which rule out the shelf", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includeLam),
        );
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includePdf),
        );
      });

      await test.step("open the shelf and check it reads empty", async () => {
        await readerShelfPage.goto(filterShelf.id);
        await expect(readerShelfPage.filteredEmptyMessage).toBeVisible();
        await expect(readerShelfPage.count).toHaveText("0");
      });

      const release =
        await test.step("drop the PDF clause while its read is held", async () => {
          const release = await filterBar.holdShelfReads(1);
          await filterBar.removeClause("format");
          await expect
            .poll(() => filterBar.heldShelfReads())
            .toBeGreaterThan(0);
          return release;
        });

      // The answer on screen belongs to the filters the reader just dropped.
      await test.step("check the old empty answer is gone", async () => {
        await expect(readerShelfPage.filteredEmptyMessage).toHaveCount(0);
        await expect(readerShelfPage.count).toHaveCount(0);
        await expect(readerShelfPage.loading).toBeVisible();
      });

      await test.step("release the read and check the new answer", async () => {
        await release();
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-2"]),
        );
      });
    });

    test("drop a shelf page's refetch error once the filter that failed is changed", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerShelfPage;

      await test.step("filter All Books to Lam PDFs, which rule out the shelf", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includeLam),
        );
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includePdf),
        );
      });

      await test.step("open the shelf while narrowed reads fail", async () => {
        await readerShelfPage.forceServerErrorWhere(
          shelves.page(),
          filteredShelfRead,
        );
        await readerShelfPage.goto(filterShelf.id);
        await expect(readerShelfPage.refetchError).toBeVisible();
      });

      const release =
        await test.step("drop the PDF clause while its read is held", async () => {
          await readerShelfPage.stopForcingServerError(shelves.page());
          const release = await filterBar.holdShelfReads(1);
          await filterBar.removeClause("format");
          await expect
            .poll(() => filterBar.heldShelfReads())
            .toBeGreaterThan(0);
          return release;
        });

      await test.step("check the old error is gone", async () => {
        await expect(readerShelfPage.refetchError).toHaveCount(0);
      });

      await test.step("release the read and check the new answer", async () => {
        await release();
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-2"]),
        );
        await expect(readerShelfPage.refetchError).toHaveCount(0);
      });
    });

    test("do not call a selected shelf empty on the landing page while a changed filter is out", async ({
      readerLibraryPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerLibraryPage;

      await test.step("filter All Books to Lam PDFs, which rule out the shelf", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includeLam),
        );
        await readerExpectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includePdf),
        );
      });

      await test.step("select the shelf and check it reads empty", async () => {
        await readerLibraryPage.selectShelf(filterShelf);
        await expect(readerLibraryPage.clearFiltersButton).toBeVisible();
      });

      const release =
        await test.step("drop the PDF clause while its read is held", async () => {
          const release = await filterBar.holdShelfReads(1);
          await filterBar.removeClause("format");
          await expect
            .poll(() => filterBar.heldShelfReads())
            .toBeGreaterThan(0);
          return release;
        });

      await test.step("check the old empty answer is gone", async () => {
        await expect(readerLibraryPage.clearFiltersButton).toHaveCount(0);
        await expect(readerLibraryPage.loading).toBeVisible();
        await expect(readerLibraryPage.filteredCount).toHaveCount(0);
      });

      await test.step("release the read and check the new answer", async () => {
        await release();
        await readerLibraryPage.assertShowsBooks(["compiler-compendium-2"]);
      });
    });

    test.describe("a shelf whose full list fails", () => {
      test.beforeEach(
        "filter to Lam, then select the shelf",
        async ({ readerLibraryPage, readerExpectMutation, filterShelf }) => {
          await readerLibraryPage.goto();
          await readerExpectMutation(ebooks.page(), () =>
            readerLibraryPage.filterBar.addClause(clauses.includeLam),
          );
          await readerLibraryPage.forceServerErrorWhere(
            shelves.page(),
            unfilteredShelfRead,
          );
          await readerLibraryPage.selectShelf(filterShelf);
        },
      );

      // The rows on screen answer the filter; only Add books needs the full list.
      test("keep the narrowed rows", async ({ readerLibraryPage }) => {
        await test.step("check the narrowed rows stand and Add books is inert", async () => {
          await readerLibraryPage.assertShowsBooks(["compiler-compendium-2"]);
          await expect(readerLibraryPage.pageError).toHaveCount(0);
          await expect(readerLibraryPage.shelfAddBooksButton).toHaveAttribute(
            "aria-disabled",
            "true",
          );
          await expect(readerLibraryPage.shelfAddBooksButton).toHaveAttribute(
            "title",
            "This shelf’s books couldn’t be loaded.",
          );
        });
      });

      test("retry the full list on Clear all", async ({
        readerLibraryPage,
        readerExpectMutation,
      }) => {
        await test.step("check the full list has failed first", async () => {
          await readerLibraryPage.assertShowsBooks(["compiler-compendium-2"]);
          await expect(readerLibraryPage.shelfAddBooksButton).toHaveAttribute(
            "aria-disabled",
            "true",
          );
          await expect(readerLibraryPage.shelfAddBooksButton).toHaveAttribute(
            "title",
            "This shelf’s books couldn’t be loaded.",
          );
        });

        await test.step("clear all once the full list can load", async () => {
          await readerLibraryPage.stopForcingServerError(shelves.page());
          await readerExpectMutation(shelves.page(), () =>
            readerLibraryPage.filterBar.clearAll(),
          );
        });

        await test.step("check the shelf's members are back", async () => {
          await readerLibraryPage.assertShowsBooks(FILTER_SHELF_SLUGS, {
            filtered: false,
          });
          await expect(readerLibraryPage.pageError).toHaveCount(0);
        });
      });
    });

    test("keep a removed book greyed until the filtered list it was drawn in lands", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const target = filterShelf.memberUuid("compiler-compendium-3");

      await test.step("filter All Books to Aho", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includeAho),
        );
      });

      await test.step("open the shelf", async () => {
        await readerShelfPage.goto(filterShelf.id);
        await readerShelfPage.assertShowsMembers(
          titlesOf([
            "compiler-compendium-1",
            "compiler-compendium-2",
            "compiler-compendium-3",
          ]),
        );
      });

      const release =
        await test.step("remove a book while the narrowed re-read is held", async () => {
          await readerShelfPage.recordRemoveButtonStates(target);
          const release = await readerShelfPage.filterBar.holdShelfReads(1);
          // The members refetch answers before the narrowed one is released.
          await readerExpectMutation(shelves.removeBook(), () =>
            readerShelfPage.removeMember(target),
          );
          await expect
            .poll(() => readerShelfPage.filterBar.heldShelfReads())
            .toBeGreaterThan(0);
          return release;
        });

      await test.step("release the read and check the book left", async () => {
        await release();
        await expect(readerShelfPage.removeButton(target)).toHaveCount(0);
      });

      await test.step("check its button was never enabled again", async () => {
        const seen = await readerShelfPage.removeButtonStates();
        expect(seen).toContain(true);
        expect(seen).not.toContain(false);
      });
    });

    test("exclude books on a shelf from All Books", async ({
      readerLibraryPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerLibraryPage;

      // PDFs only, so the expected set is exact whatever else the library holds.
      await test.step("filter All Books to PDFs", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includePdf),
        );
      });

      const { request } = await test.step("exclude the shelf", () =>
        readerExpectMutation(ebooks.page(), () =>
          filterBar.addClause({
            field: "shelf",
            mode: "exclude",
            picks: [{ label: filterShelf.name }],
          }),
        ));

      await test.step("check the shelf's books are gone", async () => {
        expect(request.postDataJSON().filters.clauses[1]).toEqual({
          field: "shelf",
          mode: "exclude",
          values: [String(filterShelf.id)],
        });
        await expect(filterBar.facet("shelf")).toHaveAccessibleName(
          `Shelf not ${filterShelf.name}`,
        );
        await readerLibraryPage.assertShowsBooks(
          slugsWhere(
            (b) => hasFormat(b, "pdf") && !FILTER_SHELF_SLUGS.includes(b.slug),
          ),
        );
      });
    });
  });
});
