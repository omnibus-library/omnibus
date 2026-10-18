import { ebooks } from "../contracts/ebooks";
import { shelves } from "../contracts/shelves";
import {
  authoredBy,
  clauses,
  FILTER_FIELDS,
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

// The filter is saved per library path in the browser's localStorage, so every
// test starts from none. They assert on the PDFs and the Compiler Compendium
// books, which no other spec edits and nothing holds an override on.

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

  test("show the library filter bar layout", async ({ libraryPage }) => {
    const { filterBar } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the page and its nav", async () => {
      await libraryPage.assertDisplayed();
      await libraryPage.topNav.assertDisplayed();
    });

    await test.step("check the filter bar", async () => {
      await expect(filterBar.root).toBeVisible();
      await expect(filterBar.addFilterButton).toBeEnabled();
      await expect(filterBar.chips).toHaveCount(0);
      await expect(filterBar.clearAllButton).toHaveCount(0);
      await expect(filterBar.picker.root).toHaveCount(0);
    });
  });

  test("open the picker listing every filter field", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("open the picker", async () => {
      await filterBar.openPicker();
    });

    await test.step("check it lists every field", async () => {
      await expect(filterBar.picker.root).toBeVisible();
      for (const field of FILTER_FIELDS) {
        await expect(filterBar.picker.fieldButton(field)).toBeVisible();
      }
      await expect(filterBar.picker.applyButton).toHaveCount(0);
    });
  });

  test("switch to table view with the filter bar still in place", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("switch to the table", async () => {
      await libraryPage.table.switchTo();
    });

    await test.step("check the filter bar is still there", async () => {
      await expect(filterBar.root).toBeVisible();
      await expect(filterBar.addFilterButton).toBeEnabled();
    });
  });

  test("close the picker on Escape without adding a clause", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the picker", async () => {
      await libraryPage.goto();
      await filterBar.openPicker();
      await expect(filterBar.picker.root).toBeFocused();
    });

    await test.step("press Escape", async () => {
      await filterBar.picker.pressKey("Escape");
    });

    await test.step("check the picker closed and added nothing", async () => {
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(filterBar.chips).toHaveCount(0);
      await expect(filterBar.addFilterButton).toBeFocused();
    });
  });

  test("keep Tab and Shift+Tab inside the open picker", async ({
    libraryPage,
  }) => {
    const { picker } = libraryPage.filterBar;

    await test.step("open the picker on a field with options", async () => {
      await libraryPage.goto();
      await libraryPage.filterBar.openPicker();
      await expect(picker.root).toHaveAttribute("aria-modal", "true");
      await picker.chooseField("format");
      await expect(picker.option("PDF")).toBeVisible();
    });

    await test.step("press Tab and Shift+Tab, checking focus stays", async () => {
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let press = 0; press < 12; press++) {
          await picker.pressKey(key);
          expect(
            await picker.focusedDialogName(),
            `${key} press ${press + 1}`,
          ).toBe("Add filter");
        }
      }
    });
  });

  test("return focus to Add filter when the picker is cancelled", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the picker and choose a field", async () => {
      await libraryPage.goto();
      await filterBar.openPicker();
      await filterBar.picker.chooseField("format");
    });

    await test.step("cancel", async () => {
      await filterBar.picker.cancel();
    });

    await test.step("check focus returned", async () => {
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(filterBar.addFilterButton).toBeFocused();
    });
  });

  test("return focus to Add filter when the picker is dismissed from the backdrop", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the picker", async () => {
      await libraryPage.goto();
      await filterBar.openPicker();
    });

    await test.step("click the backdrop", async () => {
      await filterBar.picker.dismissByScrim();
    });

    await test.step("check focus returned", async () => {
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(filterBar.addFilterButton).toBeFocused();
    });
  });

  test("add a format clause and narrow the list and count", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;
    const pdfs = slugsWhere((b) => hasFormat(b, "pdf"));

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    const { request } = await test.step("filter to PDFs", () =>
      expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includePdf),
      ));

    await test.step("check the list and count narrowed", async () => {
      expect(request.postDataJSON().filters).toEqual({
        clauses: [{ field: "format", mode: "include", values: ["pdf"] }],
      });
      await expect(filterBar.addFilterButton).toBeFocused();
      await expect(filterBar.chips).toHaveCount(1);
      await expect(filterBar.chip(0)).toContainText(
        "Format includes any of PDF",
      );
      await libraryPage.assertShowsBooks(pdfs);
    });
  });

  test("match any of several values in one clause", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;
    const wanted = ["Monica Lam", "Ravi Sethi"];

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("filter to two authors in one clause", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause({
          field: "author",
          mode: "include",
          picks: wanted.map((name) => ({ label: name, search: name })),
        }),
      );
    });

    await test.step("check one chip names both", async () => {
      await expect(filterBar.chips).toHaveCount(1);
      await expect(filterBar.chip(0)).toContainText(
        "Author includes any of Monica Lam, Ravi Sethi",
      );
      await libraryPage.assertShowsBooks(
        slugsWhere((b) => authoredBy(b, ...wanted)),
      );
    });
  });

  test("combine an exclude clause with an include clause", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("include Aho", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includeAho),
      );
    });

    await test.step("exclude Ullman", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.excludeUllman),
      );
    });

    await test.step("check both clauses apply", async () => {
      await expect(filterBar.chips).toHaveCount(2);
      await expect(filterBar.chip(1)).toContainText(
        "Author excludes any of Jeffrey Ullman",
      );
      await libraryPage.assertShowsBooks(
        slugsWhere(
          (b) =>
            authoredBy(b, "Alfred Aho") && !authoredBy(b, "Jeffrey Ullman"),
        ),
      );
    });
  });

  test("explain an empty result and clear from it", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;
    const hidden = slugsWhere((b) => authoredBy(b, "Alfred Aho"));

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("filter to Aho", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includeAho),
      );
    });

    await test.step("filter to PDFs, which rules every book out", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includePdf),
      );
    });

    await test.step("check the empty result is explained", async () => {
      await libraryPage.assertShowsBooks(
        slugsWhere((b) => authoredBy(b, "Alfred Aho") && hasFormat(b, "pdf")),
      );
      await expect(libraryPage.noMatchesMessage).toBeVisible();
      await expect(libraryPage.emptyMessage).toHaveCount(0);
      await libraryPage.recordEmptyLibraryInsertions();
    });

    const { request } = await test.step("clear the filters", () =>
      expectMutation(ebooks.page(), () => libraryPage.clearFilters()));

    await test.step("check the list is back without a false empty", async () => {
      expect(request.postDataJSON().filters).toEqual({ clauses: [] });
      await expect(filterBar.chips).toHaveCount(0);
      await libraryPage.assertShowsBooksIncluding(hidden);
      await expect
        .poll(() => libraryPage.shownCount())
        .toBeGreaterThanOrEqual(hidden.length);
      await expect(libraryPage.noMatchesMessage).toHaveCount(0);
      expect(await libraryPage.emptyLibraryInsertions()).toBe(0);
    });
  });

  test("restore the filter after a reload", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;
    const pdfs = slugsWhere((b) => hasFormat(b, "pdf"));

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("filter to PDFs", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includePdf),
      );
      await libraryPage.assertShowsBooks(pdfs);
    });

    await test.step("reload the page", async () => {
      await libraryPage.reload();
    });

    await test.step("check the filter came back", async () => {
      await expect(filterBar.chip(0)).toContainText(
        "Format includes any of PDF",
      );
      await libraryPage.assertShowsBooks(pdfs);
    });
  });

  test("clear every clause in one action", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;
    const hidden = ["time-machine", "compiler-compendium-1"];

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("add two clauses", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includePdf),
      );
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.excludeWells),
      );
      await expect(filterBar.chips).toHaveCount(2);
      await libraryPage.assertShowsBooks(
        slugsWhere((b) => hasFormat(b, "pdf") && !authoredBy(b, "H. G. Wells")),
      );
    });

    const cleared = await test.step("clear all", () =>
      expectMutation(ebooks.page(), () => filterBar.clearAll()));

    await test.step("check nothing is filtered", async () => {
      expect(cleared.request.postDataJSON().filters).toEqual({ clauses: [] });
      await expect(filterBar.chips).toHaveCount(0);
      await expect(filterBar.clearAllButton).toHaveCount(0);
      await libraryPage.assertShowsBooksIncluding(hidden);
    });

    const reloaded = await test.step("reload the page", () =>
      expectMutation(ebooks.page(), () => libraryPage.reload()));

    await test.step("check the cleared filter was forgotten", async () => {
      expect(reloaded.request.postDataJSON().filters).toEqual({ clauses: [] });
      await expect(filterBar.chips).toHaveCount(0);
      await libraryPage.assertShowsBooksIncluding(hidden);
    });
  });

  test("keep the filter bar when the page fetch fails", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the library and filter to PDFs", async () => {
      await libraryPage.goto();
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includePdf),
      );
    });

    const { request } =
      await test.step("reload while the fetch fails", async () => {
        await libraryPage.forceServerError(ebooks.page());
        return expectMutation(failing(ebooks.page(15_000)), () =>
          libraryPage.reload(),
        );
      });

    await test.step("check the bar survives the error", async () => {
      expect(request.postDataJSON().filters.clauses).toHaveLength(1);
      await expect(libraryPage.pageError).toBeVisible();
      await expect(filterBar.chip(0)).toContainText(
        "Format includes any of PDF",
      );
      await expect(filterBar.clearAllButton).toBeVisible();
    });

    // The stale filter must not trap the reader: once the server answers again,
    // one Clear all both recovers the list and forgets the saved filter.
    await test.step("clear all once the server answers", async () => {
      await libraryPage.restoreLibraryReads();
      await expectMutation(ebooks.page(), () => filterBar.clearAll());
      await expect(libraryPage.pageError).toHaveCount(0);
      await expect(filterBar.chips).toHaveCount(0);
    });

    await test.step("check the cleared filter was forgotten", async () => {
      await libraryPage.reload();
      await expect(filterBar.chips).toHaveCount(0);
      await expect(libraryPage.pageError).toHaveCount(0);
    });
  });

  test.describe("on a shelf", () => {
    test.describe.configure({ mode: "serial" });

    test("narrow a selected shelf on the landing page", async ({
      readerLibraryPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar, addBooksModal } = readerLibraryPage;

      await test.step("open the library and select the shelf", async () => {
        await readerLibraryPage.goto();
        await readerLibraryPage.selectShelf(filterShelf);
        await readerLibraryPage.assertShowsBooks(FILTER_SHELF_SLUGS);
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

      await test.step("filter All Books to Ullman", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includeUllman),
        );
      });

      // The filter set on All Books is the one this page reads.
      await test.step("open the shelf and check it read that filter", async () => {
        await readerShelfPage.goto(filterShelf.id);
        await expect(filterBar.chip(0)).toContainText(
          "Author includes any of Jeffrey Ullman",
        );
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-1", "compiler-compendium-3"]),
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
              { field: "author", mode: "include", values: ["Jeffrey Ullman"] },
              { field: "author", mode: "exclude", values: ["Ravi Sethi"] },
            ],
          },
        });
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-1"]),
        );
      });

      // Saved where the landing page reads it: both survive a reload, and All
      // Books shows the same two chips.
      await test.step("reload and check both clauses survive", async () => {
        await readerShelfPage.reload();
        await expect(filterBar.chips).toHaveCount(2);
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-1"]),
        );
      });

      await test.step("check All Books shows the same two chips", async () => {
        await readerLibraryPage.goto();
        await expect(readerLibraryPage.filterBar.chips).toHaveCount(2);
        await expect(readerLibraryPage.filterBar.chip(1)).toContainText(
          "Author excludes any of Ravi Sethi",
        );
      });
    });

    test("explain a filter that rules out every book on a shelf and clear from it", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerShelfPage;

      await test.step("filter All Books to Lam", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          readerLibraryPage.filterBar.addClause(clauses.includeLam),
        );
      });

      await test.step("open the shelf", async () => {
        await readerShelfPage.goto(filterShelf.id);
        await readerShelfPage.assertShowsMembers(
          titlesOf(["compiler-compendium-2"]),
        );
      });

      await test.step("filter it to PDFs, which rules every member out", async () => {
        await readerExpectMutation(shelves.page(), () =>
          filterBar.addClause(clauses.includePdf),
        );
      });

      await test.step("check the empty shelf is explained", async () => {
        await expect(readerShelfPage.filteredEmptyMessage).toContainText(
          "No books on this shelf match these filters.",
        );
        await expect(readerShelfPage.emptyMessage).toHaveCount(0);
        await expect(readerShelfPage.count).toHaveText("0");
      });

      // The full member list is already loaded, so clearing asks the server nothing.
      await test.step("clear the filters", async () => {
        await readerShelfPage.clearFilters();
      });

      await test.step("check every member is back", async () => {
        await expect(filterBar.chips).toHaveCount(0);
        await expect(readerShelfPage.filteredEmptyMessage).toHaveCount(0);
        await readerShelfPage.assertShowsMembers(titlesOf(FILTER_SHELF_SLUGS));
      });
    });

    test("keep the filter bar when a shelf's narrowed fetch fails on the landing page", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerLibraryPage;

      await test.step("open the library and select the shelf", async () => {
        await readerLibraryPage.goto();
        await readerLibraryPage.selectShelf(filterShelf);
      });

      await test.step("filter it to Lam while narrowed reads fail", async () => {
        await readerShelfPage.failFilteredShelfReads();
        await readerExpectMutation(failing(shelves.page()), () =>
          filterBar.addClause(clauses.includeLam),
        );
      });

      await test.step("check the error shows and the bar stays", async () => {
        await expect(readerLibraryPage.pageError).toBeVisible();
        await expect(filterBar.chips).toHaveCount(1);
      });

      // A filter the server refuses must not trap the reader: the shelf's own
      // members are already loaded, so clearing needs no further request.
      await test.step("clear all", async () => {
        await filterBar.clearAll();
      });

      await test.step("check the shelf's members are back", async () => {
        await expect(readerLibraryPage.pageError).toHaveCount(0);
        await expect(filterBar.chips).toHaveCount(0);
        await readerLibraryPage.assertShowsBooks(FILTER_SHELF_SLUGS);
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
        await readerShelfPage.failFilteredShelfReads();
        await readerExpectMutation(failing(shelves.page()), () =>
          filterBar.addClause(clauses.includeLam),
        );
      });

      await test.step("check the error shows and the bar stays", async () => {
        await expect(readerShelfPage.refetchError).toBeVisible();
        await expect(filterBar.chips).toHaveCount(1);
        // The failed fetch left no rows to count, so no count beats "0".
        await expect(readerShelfPage.count).toHaveCount(0);
        await expect(readerShelfPage.countPending).toHaveCount(0);
      });

      await test.step("clear all", async () => {
        await filterBar.clearAll();
      });

      await test.step("check the shelf's members are back", async () => {
        await expect(readerShelfPage.refetchError).toHaveCount(0);
        await expect(filterBar.chips).toHaveCount(0);
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
        await readerShelfPage.failFilteredShelfReads();
        await readerShelfPage.goto(filterShelf.id);
        await expect(readerShelfPage.refetchError).toBeVisible();
      });

      const release =
        await test.step("drop the PDF clause while its read is held", async () => {
          await readerShelfPage.restoreShelfReads();
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
        await expect(readerLibraryPage.sectionTitle).not.toContainText(
          "0 books",
        );
      });

      await test.step("release the read and check the new answer", async () => {
        await release();
        await readerLibraryPage.assertShowsBooks(["compiler-compendium-2"]);
      });
    });

    test("keep the narrowed count when the shelf's full list fails and retry it on Clear all", async ({
      readerLibraryPage,
      readerShelfPage,
      readerExpectMutation,
      filterShelf,
    }) => {
      const { filterBar } = readerLibraryPage;

      await test.step("filter All Books to Lam", async () => {
        await readerLibraryPage.goto();
        await readerExpectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includeLam),
        );
      });

      await test.step("select the shelf while its full list fails", async () => {
        await readerShelfPage.failUnfilteredShelfReads();
        await readerLibraryPage.selectShelf(filterShelf);
      });

      // The rows on screen answer the filter; only Add books needs the full list.
      await test.step("check the narrowed rows stand and Add books is inert", async () => {
        await readerLibraryPage.assertShowsBooks(["compiler-compendium-2"]);
        await expect(readerLibraryPage.pageError).toHaveCount(0);
        await expect(readerLibraryPage.shelfAddBooksButton).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      });

      await test.step("clear all once the full list can load", async () => {
        await readerShelfPage.restoreShelfReads();
        await readerExpectMutation(shelves.page(), () => filterBar.clearAll());
      });

      await test.step("check the shelf's members are back", async () => {
        await readerLibraryPage.assertShowsBooks(FILTER_SHELF_SLUGS);
        await expect(readerLibraryPage.pageError).toHaveCount(0);
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
        await expect(filterBar.chip(1)).toContainText(
          `Shelf excludes any of ${filterShelf.name}`,
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
