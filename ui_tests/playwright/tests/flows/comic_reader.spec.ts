import { progress } from "../contracts/progress";
import { readStatus } from "../contracts/readStatus";
import { comicPageAnchor, pagePercent } from "../data/progress";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Both CBZs are reserved for this spec (see fixtures/epubs.ts). COMIC takes the
// writes and PRISTINE stays untouched for the read-only tests, so parallel
// tests never share a book.
const COMIC = FIXTURE_BOOKS.find((b) => b.slug === "aurora-station-01")!;
const COMIC_PAGES = 8;
const PRISTINE = FIXTURE_BOOKS.find((b) => b.slug === "aurora-station-02")!;
const PRISTINE_PAGES = 5;

test.describe("comic pager", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  // An unread book is marked reading on open, a write PRISTINE's tests would
  // leave unasserted.
  test.beforeAll(
    "mark the pristine comic reading",
    async ({ request, presetReadStatus }) => {
      const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
      await presetReadStatus(uuid, "reading");
    },
  );

  test("show the comic pager layout", async ({ comicReaderPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the book", async () => {
      await comicReaderPage.goto(uuid);
    });

    await test.step("check the chrome shows", async () => {
      await expect(comicReaderPage.backButton).toBeVisible();
      await expect(comicReaderPage.fitWidthButton).toBeVisible();
      await expect(comicReaderPage.fitHeightButton).toBeVisible();
    });

    // The page image is a plain `<img>` against the pages endpoint.
    await test.step("check the page image shows and decodes", async () => {
      await expect(comicReaderPage.pageImage).toBeVisible();
      await expect(comicReaderPage.pageImage).toHaveAttribute(
        "src",
        `/api/ebooks/${uuid}/pages/0`,
      );
      // Decoding proves the endpoint served real bytes.
      await expect
        .poll(() => comicReaderPage.pageImageWidth())
        .toBeGreaterThan(0);
    });

    await test.step("check the page controls show", async () => {
      await expect(comicReaderPage.previousPageButton).toBeDisabled();
      await expect(comicReaderPage.nextPageButton).toBeEnabled();
      await expect(comicReaderPage.pageSlider).toBeVisible();
      await expect(comicReaderPage.pageLabel).toHaveText(
        `Page 1 of ${PRISTINE_PAGES}`,
      );
    });
  });

  test("fit the page to the stage width", async ({
    comicReaderPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the book", async () => {
      await comicReaderPage.goto(uuid);
    });

    // Fit height is the default.
    await test.step("check the stage fits the height", async () => {
      await expect(comicReaderPage.stagePanel).toHaveClass(/cr-fit-height/);
      await expect(comicReaderPage.fitHeightButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("fit it to the width", async () => {
      await comicReaderPage.fitToWidth();
      await expect(comicReaderPage.stagePanel).toHaveClass(/cr-fit-width/);
      await expect(comicReaderPage.fitWidthButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(comicReaderPage.fitHeightButton).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  // PRISTINE stays progress-free: the forced failure answers every save
  // before it reaches the server.
  test("keep turning pages when progress saves fail", async ({
    comicReaderPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the book while saves fail", async () => {
      await comicReaderPage.forceServerError(progress.save());
      await comicReaderPage.goto(uuid);
    });

    await test.step("turn the page", async () => {
      await expectMutation(failing(progress.save()), () =>
        comicReaderPage.turnPage(),
      );
    });

    await test.step("check the pager moved on", async () => {
      await expect(comicReaderPage.pageLabel).toHaveText(
        `Page 2 of ${PRISTINE_PAGES}`,
      );
      await expect(comicReaderPage.pageImage).toBeVisible();
    });
  });

  test.describe("book detail", () => {
    test("show the comic start reading action on a cbz-only book", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the comic action shows", async () => {
        await expect(bookDetailPage.startReadingComicButton).toBeVisible();
        await expect(bookDetailPage.noFilesMessage).toBeHidden();
      });
    });

    test("open the comic pager from the book detail start reading action", async ({
      bookDetailPage,
      comicReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("start reading", async () => {
        await bookDetailPage.startReadingComic();
        await comicReaderPage.assertDisplayedFor(uuid);
      });
    });
  });

  test.describe("reading progress", () => {
    // Every test writes the one reserved comic, so they run one at a time.
    // Each parks its own start state, so a leftover from an earlier run
    // cannot change what it writes.
    test.describe.configure({ mode: "default" });

    test("mark an unread comic reading when it opens", async ({
      comicReaderPage,
      request,
      parkBook,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, COMIC.title);

      await test.step("park the book unread on page 1", async () => {
        await parkBook(uuid, comicPageAnchor(0), "unread");
      });

      await test.step("open the book", async () => {
        await expectMutation(readStatus.setOnOpen(uuid, "reading"), () =>
          comicReaderPage.goto(uuid),
        );
      });
    });

    test("save the position on every page turn", async ({
      comicReaderPage,
      request,
      parkBook,
      expectMutation,
      storedPosition,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, COMIC.title);

      await test.step("park the book reading on page 1", async () => {
        await parkBook(uuid, comicPageAnchor(0), "reading");
      });

      await test.step("open the book", async () => {
        await comicReaderPage.goto(uuid);
      });

      await test.step("turn three pages", async () => {
        for (let target = 1; target <= 3; target++) {
          await expectMutation(
            progress.savePage(
              uuid,
              comicPageAnchor(target),
              pagePercent(target, COMIC_PAGES),
            ),
            () => comicReaderPage.turnPage(),
          );
          await expect(comicReaderPage.pageLabel).toHaveText(
            `Page ${target + 1} of ${COMIC_PAGES}`,
          );
        }
      });

      await test.step("check the server holds page 4", async () => {
        const record = await storedPosition(uuid);
        expect(record?.epub_cfi).toBe(comicPageAnchor(3));
        expect(record?.progress_percent).toBe(50);
        // A comic has no spine to resolve against, so the block reports the
        // percent it carries rather than inventing a chapter.
        expect(record?.resolved?.percent_through_book).toBe(50);
        expect(record?.resolved?.chapter_title).toBeUndefined();
      });
    });

    test("open a comic on its saved page", async ({
      comicReaderPage,
      request,
      parkBook,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, COMIC.title);

      await test.step("park the book reading on page 4", async () => {
        await parkBook(uuid, comicPageAnchor(3), "reading");
      });

      await test.step("open the book", async () => {
        await comicReaderPage.goto(uuid);
      });

      await test.step("check the pager restored page 4", async () => {
        await expect(comicReaderPage.pageLabel).toHaveText(
          `Page 4 of ${COMIC_PAGES}`,
        );
        await expect(comicReaderPage.pageImage).toHaveAttribute(
          "src",
          `/api/ebooks/${uuid}/pages/3`,
        );
      });
    });

    test("mark a comic finished on reaching its last page", async ({
      comicReaderPage,
      request,
      parkBook,
      expectMutation,
      storedReadStatus,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, COMIC.title);

      await test.step("park the book reading on page 4", async () => {
        await parkBook(uuid, comicPageAnchor(3), "reading");
      });

      await test.step("open the book", async () => {
        await comicReaderPage.goto(uuid);
      });

      await test.step("slide to the last page", async () => {
        await expectMutation(readStatus.set(uuid, "finished"), () =>
          expectMutation(progress.save(), () =>
            comicReaderPage.slideToPage(COMIC_PAGES - 1),
          ),
        );
      });

      await test.step("check the pager is on the last page", async () => {
        await expect(comicReaderPage.pageLabel).toHaveText(
          `Page ${COMIC_PAGES} of ${COMIC_PAGES}`,
        );
        await expect(comicReaderPage.nextPageButton).toBeDisabled();
      });

      await test.step("check the server holds the book finished", async () => {
        await expect
          .poll(() => storedReadStatus(uuid), { message: "stored read status" })
          .toBe("finished");
      });
    });

    test("keep a finished comic finished when paging back", async ({
      comicReaderPage,
      request,
      parkBook,
      expectMutation,
      storedReadStatus,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, COMIC.title);

      await test.step("park the book finished on page 8", async () => {
        await parkBook(uuid, comicPageAnchor(COMIC_PAGES - 1), "finished");
      });

      await test.step("open the book", async () => {
        await comicReaderPage.goto(uuid);
        await expect(comicReaderPage.pageLabel).toHaveText(
          `Page ${COMIC_PAGES} of ${COMIC_PAGES}`,
        );
      });

      await test.step("slide back to the first page", async () => {
        await expectMutation(progress.save(), () =>
          comicReaderPage.slideToPage(0),
        );
      });

      // Paging back saves the position but must not downgrade the status.
      await test.step("check the book is still finished", async () => {
        expect(await storedReadStatus(uuid)).toBe("finished");
      });
    });
  });
});
