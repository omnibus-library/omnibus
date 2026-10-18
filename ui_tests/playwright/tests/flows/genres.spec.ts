// Genres: the metadata-edit chip section, the landing table's Genres cell,
// and the book-detail chips.
//
// Genres are unlike every other editable field here — nothing the scanner
// parses carries one, so a book has genres only because someone assigned
// them, and they live solely in `metadata_overrides`. Every assertion below
// therefore writes shared server state, which is why this file owns
// `standalone-tundra` outright (see the fixture comment in
// `tests/fixtures/epubs.ts`).

import { overrides } from "../contracts/overrides";
import type { OverriddenBook } from "../data/overrides";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-tundra")!;

// A name no fixture title, author, series or tag carries, so only the genre itself can match it.
const GENRE = "Solarpunk";

test.describe("genres", () => {
  // One test's clear would wipe another's just-saved genres, so the file runs in a single worker.
  test.describe.configure({ mode: "default" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  // The fixture also clears the book after the test, so a failure leaves nothing behind.
  test.beforeEach(
    "clear the target's overrides",
    async ({ request, overridesRequests, overriddenBookUuids }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const cleared = await overridesRequests.deleteOverrides(uuid);
      await expect(cleared, "cleanup revert must succeed").toBeOK();
      overriddenBookUuids.add(uuid);
    },
  );

  test("show the genres layout", async ({ metadataEditPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the edit page", async () => {
      await metadataEditPage.goto(uuid);
    });

    await test.step("check the page and its nav", async () => {
      await metadataEditPage.assertDisplayed();
      await metadataEditPage.topNav.assertDisplayed();
    });

    // The label tells it from the Tags section above, which is the same control over another vocabulary.
    await test.step("check the genres section", async () => {
      await expect(metadataEditPage.genresSection).toBeVisible();
      await expect(metadataEditPage.genresLabel).toBeVisible();
      await expect(metadataEditPage.genresInput).toHaveAttribute(
        "placeholder",
        "+ add genre…",
      );
    });
  });

  test.describe("edit page", () => {
    test("assign genres from the metadata edit page", async ({
      metadataEditPage,
      bookDetailPage,
      expectMutation,
      request,
    }) => {
      const { form, genresSection } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      // Each chip lands before the next is typed: Enter re-renders the list and a fill issued before that settles is dropped.
      await test.step("open the edit page and add two genres", async () => {
        await metadataEditPage.goto(uuid);
        await metadataEditPage.addGenre("Hard Science Fiction");
        await expect(genresSection).toContainText("Hard Science Fiction");
        await metadataEditPage.addGenre("Adventure");
        await expect(genresSection).toContainText("Adventure");
      });

      await test.step("save", async () => {
        await expectMutation(overrides.save(), () => form.save());
      });

      // Genres render as their own chip list above the tags.
      await test.step("check the book page lists them", async () => {
        await bookDetailPage.assertDisplayedFor(uuid);
        await expect(bookDetailPage.genreList).toBeVisible();
        await expect(bookDetailPage.genreList).toContainText(
          "Hard Science Fiction",
        );
        await expect(bookDetailPage.genreList).toContainText("Adventure");
      });
    });

    test("keep the scanned tags when editing genres", async ({
      metadataEditPage,
      overridesRequests,
      expectMutation,
      request,
    }) => {
      const { form, genresSection } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page and add a genre", async () => {
        await metadataEditPage.goto(uuid);
        await metadataEditPage.addGenre("Noir");
        await expect(genresSection).toContainText("Noir");
      });

      await test.step("save", async () => {
        await expectMutation(overrides.save(), () => form.save());
      });

      // A genres override must not write a subjects one: that would pin the scanned tags against a later rescan.
      await test.step("read the book back", async () => {
        const read = await overridesRequests.getEbook(uuid);
        await expect(read).toBeOK();
        const book: OverriddenBook = await read.json();
        expect(book.genres).toEqual(["Noir"]);
        expect(book.subjects).toEqual(TARGET.tags ?? []);
      });
    });
  });

  test.describe("table cell", () => {
    test("open the genres cell as an inline chip editor", async ({
      libraryPage,
    }) => {
      const cell = libraryPage.genresCell(TARGET.slug);
      const input = libraryPage.genresCellInput(TARGET.slug);

      await test.step("open the table and click the cell", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await libraryPage.openGenresCell(TARGET.slug);
      });

      await test.step("check the chip editor shows", async () => {
        await expect(input).toBeVisible();
        await expect(input).toHaveAttribute("placeholder", "+ add genre…");
        await expect(cell).toHaveClass(/ebook-cell-editing/);
      });

      await test.step("leave with Escape", async () => {
        await libraryPage.closeGenresCell(TARGET.slug);
        await expect(input).toHaveCount(0);
        await expect(cell).not.toHaveClass(/ebook-cell-editing/);
      });
    });

    test("assign a genre inline from the table", async ({
      libraryPage,
      expectMutation,
    }) => {
      const cell = libraryPage.genresCell(TARGET.slug);

      await test.step("open the table and click the cell", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await libraryPage.openGenresCell(TARGET.slug);
      });

      await test.step("add a genre", async () => {
        await libraryPage.typeGenreInCell(TARGET.slug, "Techno-Thriller");
        await expectMutation(overrides.save(), () =>
          libraryPage.commitGenreInCell(TARGET.slug),
        );
      });

      await test.step("check the cell shows the server-merged value", async () => {
        await libraryPage.assertDisplayed();
        await expect(cell).toContainText("Techno-Thriller");
        await libraryPage.closeGenresCell(TARGET.slug);
        await expect(cell).toContainText("Techno-Thriller");
      });
    });

    test("keep the cell unchanged when the genre save fails", async ({
      libraryPage,
      expectMutation,
    }) => {
      await test.step("open the table and click the cell", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await libraryPage.openGenresCell(TARGET.slug);
      });

      await test.step("add a genre while the server fails the write", async () => {
        await libraryPage.forceServerError(overrides.save());
        await libraryPage.typeGenreInCell(TARGET.slug, "Never Saved");
        await expectMutation(failing(overrides.save()), () =>
          libraryPage.commitGenreInCell(TARGET.slug),
        );
      });

      // The optimistic state is replaced only by a successful answer, so a rejected save leaves no genre in the cell.
      await test.step("reload and check the cell never took it", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await expect(libraryPage.genresCell(TARGET.slug)).not.toContainText(
          "Never Saved",
        );
      });
    });
  });

  // Genres reach `books_fts` on the override save itself, so one is searchable
  // with no reindex between. The palette is the only web entry to `/search/:query`.
  test.describe("search", () => {
    test("group an assigned genre in the palette", async ({
      libraryPage,
      assignGenres,
      request,
    }) => {
      const palette = libraryPage.topNav.searchPalette;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("assign the genre through the api", async () => {
        await assignGenres(uuid, [GENRE]);
      });

      await test.step("search the palette for it", async () => {
        await libraryPage.goto();
        await palette.search(GENRE);
      });

      await test.step("check one genre row names it and counts its books", async () => {
        await expect(libraryPage.paletteGenreRows).toHaveCount(1);
        await expect(libraryPage.paletteGenreRows).toContainText(GENRE);
        await expect(libraryPage.paletteGenreRows).toContainText("1 book");
      });
    });

    test("refine the search to a genre from the palette", async ({
      libraryPage,
      genreSearchPage,
      assignGenres,
      request,
    }) => {
      const palette = libraryPage.topNav.searchPalette;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("assign the genre and search the palette for it", async () => {
        await assignGenres(uuid, [GENRE]);
        await libraryPage.goto();
        await palette.search(GENRE);
        await expect(libraryPage.paletteGenreRows).toHaveCount(1);
      });

      await test.step("pick the genre row", async () => {
        await libraryPage.refineToPaletteGenre();
      });

      // The book itself is the hit on the full-page results.
      await test.step("check the results are scoped to the genre", async () => {
        await genreSearchPage.assertDisplayedFor(GENRE);
        await expect(genreSearchPage.bookRows).toContainText(TARGET.title);
      });
    });

    // Free text stays scoped to title, authors and series, so a genre-only match is a refinement and not a book hit.
    test("keep a genre name out of free-text results", async ({
      libraryPage,
      assignGenres,
      request,
    }) => {
      const palette = libraryPage.topNav.searchPalette;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("assign the genre and search the palette for it", async () => {
        await assignGenres(uuid, [GENRE]);
        await libraryPage.goto();
        await palette.search(GENRE);
        await expect(libraryPage.paletteGenreRows).toHaveCount(1);
      });

      await test.step("check the book is not listed as a book hit", async () => {
        await expect
          .poll(async () => {
            const texts = await libraryPage.paletteBookRowTexts();
            return texts.filter((t) => t.includes(TARGET.title)).length;
          })
          .toBe(0);
      });
    });

    test("drop a book from the genre results once its genres are cleared", async ({
      libraryPage,
      assignGenres,
      request,
    }) => {
      const palette = libraryPage.topNav.searchPalette;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("assign the genre and find it in the palette", async () => {
        await assignGenres(uuid, [GENRE]);
        await libraryPage.goto();
        await palette.search(GENRE);
        await expect(libraryPage.paletteGenreRows).toHaveCount(1);
      });

      // An empty list is the clear-all override, and the index has to follow it.
      await test.step("clear the genres and search again", async () => {
        await assignGenres(uuid, []);
        await libraryPage.goto();
        await palette.search(GENRE);
      });

      await test.step("check the palette no longer groups the genre", async () => {
        await expect(libraryPage.paletteGenreRows).toHaveCount(0);
      });
    });
  });
});
