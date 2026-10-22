import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

test.beforeAll("seed the library", async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test.describe("author page", () => {
  test("show the author page layout", async ({ authorPage, authorId }) => {
    await test.step("open an author", async () => {
      await authorPage.goto(await authorId("Ada Lovelace"));
    });

    await test.step("check the name, counts and progress", async () => {
      await authorPage.assertDisplayed();
      await authorPage.topNav.assertDisplayed();
      await expect(authorPage.heading).toContainText("Ada");
      await expect(authorPage.heading).toContainText("Lovelace");
      await expect(authorPage.meta).toContainText("book");
      await expect(authorPage.readingStrip).toBeVisible();
      await expect(authorPage.showInLibraryButton).toBeVisible();
    });
  });

  test("show the author's books in the library", async ({
    authorPage,
    libraryPage,
    authorId,
  }) => {
    const name = "Niklaus Wirth";

    await test.step("show the author in the library", async () => {
      // A fresh context has saved no library prefs: the filter is handed over.
      await authorPage.goto(await authorId(name));
      await authorPage.showInLibrary(name);
    });

    await test.step("check the library is narrowed to them", async () => {
      await libraryPage.assertDisplayed();
      await expect(libraryPage.filterBar.facet("author")).toHaveAccessibleName(
        `Author ${name}`,
      );
    });

    await test.step("check the filter outlives a reload", async () => {
      await libraryPage.goto();
      await expect(libraryPage.filterBar.facet("author")).toHaveAccessibleName(
        `Author ${name}`,
      );
    });
  });

  test("leave a selected shelf to show the author's books", async ({
    authorPage,
    libraryPage,
    authorId,
    ownShelf,
  }) => {
    const name = "Niklaus Wirth";
    const shelf = await ownShelf("Show in library");

    await test.step("pick an empty shelf on the library", async () => {
      // The landing restores its last shelf pick, which would hide the books.
      await libraryPage.goto();
      await libraryPage.selectShelf(shelf);
    });

    await test.step("show the author in the library", async () => {
      await authorPage.goto(await authorId(name));
      await authorPage.showInLibrary(name);
    });

    await test.step("check it lists All Books, narrowed", async () => {
      await expect(libraryPage.shelfGallery.selectedTab).toContainText(
        "All Books",
      );
      await expect(libraryPage.filterBar.facet("author")).toHaveAccessibleName(
        `Author ${name}`,
      );
    });
  });

  test("show the books by the author", async ({ authorPage, authorId }) => {
    await test.step("open an author with a four-book series", async () => {
      await authorPage.goto(await authorId("Niklaus Wirth"));
    });

    await test.step("check the series and its first book", async () => {
      await expect(authorPage.heading).toContainText("Wirth");
      await expect(authorPage.seriesLink("Code Quartet")).toBeVisible();
      await expect(authorPage.bookTitle("Quartet I: Lexer")).toBeVisible();
    });
  });

  test("link the series heading to the series page", async ({
    authorPage,
    seriesPage,
    authorId,
  }) => {
    await test.step("open an author whose books share one series", async () => {
      // Wirth's four books all belong to Code Quartet, one shelf with one
      // "Series page" link.
      await authorPage.goto(await authorId("Niklaus Wirth"));
      await expect(authorPage.seriesLink("Code Quartet")).toBeVisible();
    });

    await test.step("click the series heading", async () => {
      await authorPage.openSeries("Code Quartet");
    });

    await test.step("check the series page opens", async () => {
      await seriesPage.assertShowsSeries("Code Quartet");
    });
  });
});

test.describe("book detail", () => {
  test("link the shelf stop to the series page", async ({
    bookDetailPage,
    seriesPage,
    request,
  }) => {
    // "Beta in the Series" is Pioneers #1, so its Shelf stop draws the whole series
    // with a "series page →" link; the Home kicker's link is in book_detail.spec.ts.
    const beta = FIXTURE_BOOKS.find((book) => book.slug === "beta")!;

    await test.step("open the first book of a series", async () => {
      await bookDetailPage.goto(
        await fetchBookUuidByTitle(request, beta.title),
      );
      await expect(bookDetailPage.seriesShelf).toBeVisible();
    });

    await test.step("click the series page link", async () => {
      await bookDetailPage.openSeriesPage();
    });

    await test.step("check the series page opens", async () => {
      await seriesPage.assertShowsSeries("Pioneers");
    });
  });
});

test.describe("series page", () => {
  test("show the series page layout", async ({ seriesPage, seriesId }) => {
    await test.step("open a series", async () => {
      await seriesPage.goto(await seriesId("Pioneers"));
    });

    await test.step("check the name, counts and progress", async () => {
      await seriesPage.assertDisplayed();
      await seriesPage.topNav.assertDisplayed();
      await expect(seriesPage.heading).toHaveText("Pioneers");
      await expect(seriesPage.meta).toContainText("5 books");
      await expect(seriesPage.readingStrip).toBeVisible();
      await expect(seriesPage.showInLibraryButton).toBeVisible();
    });
  });

  test("list the books in order", async ({ seriesPage, seriesId }) => {
    await test.step("open a five-book series", async () => {
      await seriesPage.goto(await seriesId("Pioneers"));
    });

    await test.step("check the covers and the first number", async () => {
      await expect(seriesPage.bookCards).toHaveCount(5);
      await expect(seriesPage.firstCardNumberLabel).toBeVisible();
    });
  });

  test("open the book from its number", async ({
    seriesPage,
    bookDetailPage,
    seriesId,
  }) => {
    await test.step("open a series", async () => {
      await seriesPage.goto(await seriesId("Pioneers"));
      await expect(seriesPage.firstCardNumberLabel).toBeVisible();
    });

    await test.step("click the first cover's number", async () => {
      await seriesPage.openFirstBookFromItsNumber();
    });

    await test.step("check the book opens", async () => {
      await bookDetailPage.assertDisplayed();
    });
  });

  test("lead back to the list at phone width", async ({
    seriesPage,
    seriesIndexPage,
    seriesId,
  }) => {
    await test.step("open a series beside the list", async () => {
      await seriesPage.goto(await seriesId("Pioneers"));
      await expect(seriesPage.backLink).toBeHidden();
    });

    await test.step("narrow to a phone, where the list is hidden", async () => {
      await seriesPage.resizeViewport({ width: 390, height: 844 });
      await expect(seriesIndexPage.filterField).toBeHidden();
    });

    await test.step("follow the link back to the list", async () => {
      await seriesPage.goBackToList();
      await seriesIndexPage.assertDisplayed();
      await expect(seriesIndexPage.filterField).toBeVisible();
    });
  });

  test("show the series' books in the library", async ({
    seriesPage,
    libraryPage,
    seriesId,
  }) => {
    const name = "Code Quartet";

    await test.step("show the series in the library", async () => {
      await seriesPage.goto(await seriesId(name));
      await seriesPage.showInLibrary(name);
    });

    await test.step("check the library is narrowed to it", async () => {
      await libraryPage.assertDisplayed();
      await expect(libraryPage.filterBar.facet("series")).toHaveAccessibleName(
        `Series ${name}`,
      );
    });
  });
});
