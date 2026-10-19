import { authors } from "../contracts/authors";
import { ebooks } from "../contracts/ebooks";
import {
  authoredBy,
  clauses,
  FILTERED_AUTHORS,
  hasFormat,
  slugsWhere,
} from "../data/libraryFilters";
import { AUDIOBOOK_BOOKS } from "../fixtures/audiobooks";
import { type ExpectedBook, FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The filter is saved per library path in the browser's localStorage, so every
// test starts from none. They assert on the PDFs and the Compiler Compendium
// books, which no other spec edits and nothing holds an override on.

const COMPENDIUM = "Compiler Compendium";

function inCompendium(book: ExpectedBook): boolean {
  return book.series === COMPENDIUM;
}

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

    await test.step("check the bar has one idle facet per field", async () => {
      await expect(filterBar.root).toBeVisible();
      await expect(filterBar.facets).toHaveText([
        "Shelf",
        "Tag",
        "Genre",
        "Author",
        "Series",
        "Format",
      ]);
      await expect(filterBar.facet("author")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(filterBar.facetClearButtons).toHaveCount(0);
      await expect(filterBar.clearAllButton).toHaveCount(0);
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(libraryPage.filteredCount).toHaveCount(0);
    });
  });

  test("open a facet straight onto its field's values", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;
    const { picker } = filterBar;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("open the Format facet", async () => {
      await filterBar.openFacet("format");
    });

    await test.step("check its menu lists the formats to pick", async () => {
      await expect(picker.root).toHaveAccessibleName("Filter by format");
      await expect(filterBar.facet("format")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(picker.modeButton("include", true)).toBeVisible();
      await expect(picker.searchField).toHaveAccessibleName("Search formats");
      await expect(picker.option("PDF")).not.toBeChecked();
      await expect(picker.applyButton).toBeDisabled();
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
      await expect(filterBar.facet("format")).toBeEnabled();
    });
  });

  test("close a facet's menu on Escape without adding a clause", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the Format facet", async () => {
      await libraryPage.goto();
      await filterBar.openFacet("format");
      await expect(filterBar.picker.root).toBeFocused();
    });

    await test.step("press Escape", async () => {
      await filterBar.picker.pressKey("Escape");
    });

    await test.step("check the menu closed and added nothing", async () => {
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(filterBar.facetClearButtons).toHaveCount(0);
      await expect(filterBar.facet("format")).toBeFocused();
    });
  });

  test("keep Tab and Shift+Tab inside a facet's open menu", async ({
    libraryPage,
  }) => {
    const { picker } = libraryPage.filterBar;

    await test.step("open the Format facet", async () => {
      await libraryPage.goto();
      await libraryPage.filterBar.openFacet("format");
      await expect(picker.root).toHaveAttribute("aria-modal", "true");
      await expect(picker.option("PDF")).toBeVisible();
    });

    await test.step("press Tab and Shift+Tab, checking focus stays", async () => {
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let press = 0; press < 12; press++) {
          await picker.pressKey(key);
          expect(
            await picker.focusedDialogName(),
            `${key} press ${press + 1}`,
          ).toBe("Filter by format");
        }
      }
    });
  });

  test("return focus to the facet when its menu is cancelled", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the Format facet", async () => {
      await libraryPage.goto();
      await filterBar.openFacet("format");
    });

    await test.step("cancel", async () => {
      await filterBar.picker.cancel();
    });

    await test.step("check focus returned", async () => {
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(filterBar.facet("format")).toBeFocused();
    });
  });

  test("return focus to the facet when its menu is dismissed from the backdrop", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the Shelf facet", async () => {
      await libraryPage.goto();
      await filterBar.openFacet("shelf");
    });

    await test.step("click the backdrop", async () => {
      await filterBar.picker.dismissByScrim();
    });

    await test.step("check focus returned", async () => {
      await expect(filterBar.picker.root).toHaveCount(0);
      await expect(filterBar.facet("shelf")).toBeFocused();
    });
  });

  test("retry a facet's values after they fail to load", async ({
    libraryPage,
  }) => {
    const { filterBar } = libraryPage;
    const { picker } = filterBar;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("open the Author facet while the authors fail", async () => {
      await libraryPage.forceServerError(authors.list());
      await filterBar.openFacet("author");
    });

    await test.step("check the menu says so and offers a retry", async () => {
      await expect(picker.errorAlert).toContainText("Couldn’t load authors.");
      await expect(picker.option("Alfred Aho")).toHaveCount(0);
    });

    await test.step("retry once the server answers", async () => {
      await libraryPage.stopForcingServerError(authors.list());
      await picker.retry();
    });

    await test.step("check the authors are listed", async () => {
      await expect(picker.errorAlert).toHaveCount(0);
      await expect(picker.option("Alfred Aho")).toBeVisible();
    });
  });

  test("narrow the list with a format clause", async ({
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

    await test.step("check the facet names the format and the list narrowed", async () => {
      expect(request.postDataJSON().filters).toEqual({
        clauses: [{ field: "format", mode: "include", values: ["pdf"] }],
      });
      await expect(filterBar.facet("format")).toBeFocused();
      await expect(filterBar.facet("format")).toHaveAccessibleName(
        "Format PDF",
      );
      await expect(filterBar.facetClearButtons).toHaveCount(1);
      await expect(filterBar.facetClearButton("format")).toBeVisible();
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

    const { request } =
      await test.step("filter to two authors in one clause", () =>
        expectMutation(ebooks.page(), () =>
          filterBar.addClause({
            field: "author",
            mode: "include",
            picks: wanted.map((name) => ({ label: name, search: name })),
          }),
        ));

    await test.step("check the facet names the first and counts the rest", async () => {
      expect(request.postDataJSON().filters).toEqual({
        clauses: [{ field: "author", mode: "include", values: wanted }],
      });
      await expect(filterBar.facetClearButtons).toHaveCount(1);
      await expect(filterBar.facet("author")).toHaveAccessibleName(
        "Author Monica Lam +1",
      );
      await libraryPage.assertShowsBooks(
        slugsWhere((b) => authoredBy(b, ...wanted)),
      );
    });
  });

  test("combine an exclude clause with an include clause on another field", async ({
    libraryPage,
    expectMutation,
  }) => {
    const { filterBar } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("include the Compiler Compendium series", async () => {
      await expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.includeCompendium),
      );
    });

    const { request } = await test.step("exclude Ullman", () =>
      expectMutation(ebooks.page(), () =>
        filterBar.addClause(clauses.excludeUllman),
      ));

    await test.step("check both clauses apply", async () => {
      expect(request.postDataJSON().filters).toEqual({
        clauses: [
          { field: "series", mode: "include", values: [COMPENDIUM] },
          { field: "author", mode: "exclude", values: ["Jeffrey Ullman"] },
        ],
      });
      await expect(filterBar.facetClearButtons).toHaveCount(2);
      await expect(filterBar.facet("series")).toHaveAccessibleName(
        `Series ${COMPENDIUM}`,
      );
      await expect(filterBar.facet("author")).toHaveAccessibleName(
        "Author not Jeffrey Ullman",
      );
      await libraryPage.assertShowsBooks(
        slugsWhere((b) => inCompendium(b) && !authoredBy(b, "Jeffrey Ullman")),
      );
    });
  });

  test.describe("one facet per field", () => {
    test.beforeEach(
      "filter to the Compiler Compendium, then to Lam",
      async ({ libraryPage, expectMutation }) => {
        const { filterBar } = libraryPage;
        await libraryPage.goto();
        await expectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includeCompendium),
        );
        await expectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includeLam),
        );
        await libraryPage.assertShowsBooks(
          slugsWhere((b) => inCompendium(b) && authoredBy(b, "Monica Lam")),
        );
      },
    );

    test("clear one field with its facet's clear button", async ({
      libraryPage,
      expectMutation,
    }) => {
      const { filterBar } = libraryPage;

      const { request } = await test.step("clear the Author facet", () =>
        expectMutation(ebooks.page(), () => filterBar.removeClause("author")));

      await test.step("check only the author clause went", async () => {
        expect(request.postDataJSON().filters).toEqual({
          clauses: [{ field: "series", mode: "include", values: [COMPENDIUM] }],
        });
        await expect(filterBar.facet("author")).toHaveAccessibleName("Author");
        await expect(filterBar.facetClearButton("author")).toHaveCount(0);
        await expect(filterBar.facet("series")).toHaveAccessibleName(
          `Series ${COMPENDIUM}`,
        );
        await expect(filterBar.facetClearButtons).toHaveCount(1);
        await expect(filterBar.clearAllButton).toBeVisible();
        await libraryPage.assertShowsBooks(slugsWhere(inCompendium));
      });
    });

    test("replace a field's clause by applying its facet again", async ({
      libraryPage,
      expectMutation,
    }) => {
      const { filterBar } = libraryPage;
      const { picker } = filterBar;

      await test.step("reopen the Author facet", async () => {
        await filterBar.openFacet("author");
      });

      await test.step("check it opens on the clause it shows", async () => {
        await expect(picker.root).toHaveAccessibleName("Filter by author");
        await expect(picker.modeButton("include", true)).toBeVisible();
        await expect(picker.option("Monica Lam")).toBeChecked();
        await expect(picker.applyButton).toHaveText("Apply (1)");
      });

      const excluded = await test.step("switch it to exclude", () =>
        expectMutation(ebooks.page(), async () => {
          await picker.chooseMode("exclude");
          await picker.apply();
        }));

      await test.step("check the exclusion replaced the inclusion", async () => {
        expect(excluded.request.postDataJSON().filters).toEqual({
          clauses: [
            { field: "series", mode: "include", values: [COMPENDIUM] },
            { field: "author", mode: "exclude", values: ["Monica Lam"] },
          ],
        });
        await expect(filterBar.facet("author")).toHaveAccessibleName(
          "Author not Monica Lam",
        );
        await libraryPage.assertShowsBooks(
          slugsWhere((b) => inCompendium(b) && !authoredBy(b, "Monica Lam")),
        );
      });

      await test.step("reopen the facet and check it keeps the exclusion", async () => {
        await filterBar.openFacet("author");
        await expect(picker.modeButton("exclude", true)).toBeVisible();
        await expect(picker.option("Monica Lam")).toBeChecked();
      });

      const widened = await test.step("add Sethi to the clause", () =>
        expectMutation(ebooks.page(), async () => {
          await picker.pick({ label: "Ravi Sethi", search: "Sethi" });
          await picker.apply();
        }));

      await test.step("check one author clause holds both", async () => {
        expect(widened.request.postDataJSON().filters).toEqual({
          clauses: [
            { field: "series", mode: "include", values: [COMPENDIUM] },
            {
              field: "author",
              mode: "exclude",
              values: ["Monica Lam", "Ravi Sethi"],
            },
          ],
        });
        await expect(filterBar.facetClearButtons).toHaveCount(2);
        await expect(filterBar.facet("author")).toHaveAccessibleName(
          "Author not Monica Lam +1",
        );
        await libraryPage.assertShowsBooks(
          slugsWhere(
            (b) =>
              inCompendium(b) && !authoredBy(b, "Monica Lam", "Ravi Sethi"),
          ),
        );
      });
    });
  });

  test.describe("an empty result", () => {
    test.beforeEach(
      "filter to Aho, then to PDFs",
      async ({ libraryPage, expectMutation }) => {
        const { filterBar } = libraryPage;
        await libraryPage.goto();
        await expectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includeAho),
        );
        await expectMutation(ebooks.page(), () =>
          filterBar.addClause(clauses.includePdf),
        );
      },
    );

    test("explain an empty result", async ({ libraryPage }) => {
      await test.step("check the empty result is explained", async () => {
        await libraryPage.assertShowsBooks(
          slugsWhere((b) => authoredBy(b, "Alfred Aho") && hasFormat(b, "pdf")),
        );
        await expect(libraryPage.noMatchesMessage).toBeVisible();
        await expect(libraryPage.emptyMessage).toHaveCount(0);
      });
    });

    test("bring the list back without a false empty when the filters are cleared", async ({
      libraryPage,
      expectMutation,
    }) => {
      const { filterBar } = libraryPage;
      const hidden = slugsWhere((b) => authoredBy(b, "Alfred Aho"));

      await test.step("watch for a false empty", async () => {
        await libraryPage.recordEmptyLibraryInsertions();
      });

      const { request } = await test.step("clear the filters", () =>
        expectMutation(ebooks.page(), () => libraryPage.clearFilters()));

      await test.step("check the list is back without a false empty", async () => {
        expect(request.postDataJSON().filters).toEqual({ clauses: [] });
        await expect(filterBar.facetClearButtons).toHaveCount(0);
        await libraryPage.assertShowsBooksIncluding(hidden);
        await expect
          .poll(() => libraryPage.shelfGallery.allBooksTotal())
          .toBeGreaterThanOrEqual(hidden.length);
        await expect(libraryPage.noMatchesMessage).toHaveCount(0);
        expect(await libraryPage.emptyLibraryInsertions()).toBe(0);
      });
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
      await expect(filterBar.facet("format")).toHaveAccessibleName(
        "Format PDF",
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
      await expect(filterBar.facetClearButtons).toHaveCount(2);
      await libraryPage.assertShowsBooks(
        slugsWhere((b) => hasFormat(b, "pdf") && !authoredBy(b, "H. G. Wells")),
      );
    });

    const cleared = await test.step("clear all", () =>
      expectMutation(ebooks.page(), () => filterBar.clearAll()));

    await test.step("check nothing is filtered", async () => {
      expect(cleared.request.postDataJSON().filters).toEqual({ clauses: [] });
      await expect(filterBar.facetClearButtons).toHaveCount(0);
      await expect(filterBar.facet("format")).toHaveAccessibleName("Format");
      await expect(filterBar.facet("author")).toHaveAccessibleName("Author");
      await expect(filterBar.clearAllButton).toHaveCount(0);
      await expect(libraryPage.filteredCount).toHaveCount(0);
      await libraryPage.assertShowsBooksIncluding(hidden);
    });

    const reloaded = await test.step("reload the page", () =>
      expectMutation(ebooks.page(), () => libraryPage.reload()));

    await test.step("check the cleared filter was forgotten", async () => {
      expect(reloaded.request.postDataJSON().filters).toEqual({ clauses: [] });
      await expect(filterBar.facetClearButtons).toHaveCount(0);
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
      await expect(filterBar.facet("format")).toHaveAccessibleName(
        "Format PDF",
      );
      await expect(filterBar.clearAllButton).toBeVisible();
    });

    // The stale filter must not trap the reader: once the server answers again,
    // one Clear all both recovers the list and forgets the saved filter.
    await test.step("clear all once the server answers", async () => {
      await libraryPage.stopForcingServerError(ebooks.page());
      await expectMutation(ebooks.page(), () => filterBar.clearAll());
      await expect(libraryPage.pageError).toHaveCount(0);
      await expect(filterBar.facetClearButtons).toHaveCount(0);
    });

    await test.step("check the cleared filter was forgotten", async () => {
      await libraryPage.reload();
      await expect(filterBar.facetClearButtons).toHaveCount(0);
      await expect(libraryPage.pageError).toHaveCount(0);
    });
  });
});
