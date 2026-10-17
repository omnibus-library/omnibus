import { bookmarks } from "../contracts/bookmarks";
import { highlights } from "../contracts/highlights";
import { progress } from "../contracts/progress";
import { readStatus } from "../contracts/readStatus";
import { pdfPageBookmark, type SeededBookmark } from "../data/bookmarks";
import { pdfHighlightRange, sentHighlight } from "../data/highlights";
import { pagePercent, pdfPageAnchor } from "../data/progress";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { buildJpxPdf, JPX_FILL } from "../fixtures/jpx_pdf";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Both PDF fixtures are reserved for this spec (see fixtures/epubs.ts), and
// the split matters even within it: the suite is fullyParallel, so the
// write-path tests (PDF, which takes the progress, read-status, highlight
// and bookmark writes) and the read-only tests (PRISTINE, which assert a
// page-1 open) can run concurrently — a shared book would race.
const PDF = FIXTURE_BOOKS.find((b) => b.slug === "time-machine")!;
const PRISTINE = FIXTURE_BOOKS.find((b) => b.slug === "flatland")!;
// A saved selection anchors as `pdf:{page}:{quads}`, eight coordinates a quad.
const SELECTION_RANGE =
  /^pdf:8:(-?\d+(\.\d)?,){7}-?\d+(\.\d)?(;(-?\d+(\.\d)?,){7}-?\d+(\.\d)?)*$/;

test.describe("pdf reader", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  // An unread book is marked reading on open, a write PRISTINE's tests would
  // leave unasserted.
  test.beforeAll(
    "mark the pristine pdf reading",
    async ({ request, presetReadStatus }) => {
      const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
      await presetReadStatus(uuid, "reading");
    },
  );

  test("show the pdf reader layout", async ({ pdfReaderPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the book", async () => {
      await pdfReaderPage.goto(uuid);
    });

    await test.step("check the chrome shows", async () => {
      await expect(pdfReaderPage.backButton).toBeVisible();
      await expect(pdfReaderPage.titleHeading).toHaveText(PRISTINE.title);
      await expect(pdfReaderPage.highlightsButton).toBeVisible();
      await expect(pdfReaderPage.bookmarksButton).toBeVisible();
      await expect(pdfReaderPage.fitWidthButton).toBeVisible();
      await expect(pdfReaderPage.fitHeightButton).toBeVisible();
    });

    // PDF.js rasterised a canvas and laid its text layer over it, which proves
    // the file route served real bytes and the worker ran.
    await test.step("check the page renders", async () => {
      await expect(pdfReaderPage.pageCanvas).toHaveCount(1);
      await expect.poll(() => pdfReaderPage.canvasWidth()).toBeGreaterThan(0);
      // The cover is a scan with no text, so the layer is present but empty.
      await expect(pdfReaderPage.textLayer).toHaveCount(1);
    });

    await test.step("check the page controls show", async () => {
      await expect(pdfReaderPage.previousPageButton).toBeDisabled();
      await expect(pdfReaderPage.nextPageButton).toBeEnabled();
      await expect(pdfReaderPage.pageSlider).toBeVisible();
      const count = await pdfReaderPage.pageCount();
      expect(count, "page count from the label").toBeGreaterThan(1);
      await expect(pdfReaderPage.pageLabel).toHaveText(`Page 1 of ${count}`);
    });
  });

  // PDF.js drops a JPX image silently when its WASM decoder is missing, and
  // nothing in the seeded library carries one, so the book's file is stubbed.
  test("decode a jpeg 2000 image through the bundled openjpeg module", async ({
    pdfReaderPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("serve a jpeg 2000 pdf as the book", async () => {
      await pdfReaderPage.stubBookFile(uuid, buildJpxPdf());
    });

    const decoder = pdfReaderPage.waitForJpxDecoder();
    await test.step("open the book", async () => {
      await pdfReaderPage.goto(uuid);
      await expect(pdfReaderPage.pageLabel).toHaveText("Page 1 of 2");
    });

    // The worker asked for the decoder at the bundled directory and the server
    // answered with a WASM body, not a 404 page.
    await test.step("check the decoder downloaded", async () => {
      const response = await decoder;
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/wasm");
    });

    // The page is the image, so the canvas centre carries its fill rather than
    // the white a dropped image leaves. The canvas is colour-managed, hence 8.
    await test.step("check the image decoded", async () => {
      await expect
        .poll(async () =>
          (await pdfReaderPage.canvasCentrePixel()).every(
            (value, channel) => Math.abs(value - JPX_FILL[channel]!) <= 8,
          ),
        )
        .toBe(true);
    });
  });

  test("fit the page to the stage width", async ({
    pdfReaderPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the book", async () => {
      await pdfReaderPage.goto(uuid);
    });

    // Fit height is the default.
    await test.step("check the stage fits the height", async () => {
      await expect(pdfReaderPage.stagePanel).toHaveClass(/cr-fit-height/);
      await expect(pdfReaderPage.fitHeightButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("fit it to the width", async () => {
      await pdfReaderPage.fitToWidth();
      await expect(pdfReaderPage.stagePanel).toHaveClass(/cr-fit-width/);
      await expect(pdfReaderPage.fitWidthButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // The re-render keeps the page painted at the new size.
      await expect(pdfReaderPage.pageCanvas).toHaveCount(1);
    });
  });

  // PRISTINE stays progress-free: the forced failure answers every save
  // before it reaches the server.
  test("keep turning pages when progress saves fail", async ({
    pdfReaderPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the book while saves fail", async () => {
      await pdfReaderPage.forceServerError(progress.save());
      await pdfReaderPage.goto(uuid);
    });

    await test.step("turn the page", async () => {
      await expectMutation(failing(progress.save()), () =>
        pdfReaderPage.turnPage(),
      );
    });

    await test.step("check the reader moved on", async () => {
      await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 2 of \d+$/);
      await expect(pdfReaderPage.pageCanvas).toHaveCount(1);
    });
  });

  test("close the highlights drawer with escape", async ({
    pdfReaderPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

    await test.step("open the highlights drawer", async () => {
      await pdfReaderPage.goto(uuid);
      await pdfReaderPage.openHighlights();
      await expect(pdfReaderPage.highlightsDrawer.root).toBeVisible();
    });

    await test.step("close it with escape", async () => {
      await pdfReaderPage.closeWithEscape();
      await expect(pdfReaderPage.highlightsDrawer.root).toHaveCount(0);
    });
  });

  test.describe("book detail", () => {
    test("show the pdf start reading action on a pdf-only book", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the pdf actions show", async () => {
        await expect(bookDetailPage.startReadingPdfButton).toBeVisible();
        await expect(bookDetailPage.noFilesMessage).toBeHidden();
        await expect(bookDetailPage.readPdfButton).toBeVisible();
      });
    });

    test("open the pdf reader from the book detail start reading action", async ({
      bookDetailPage,
      pdfReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("start reading", async () => {
        await bookDetailPage.startReadingPdf();
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 1 of \d+$/, {
          timeout: 20_000,
        });
        await pdfReaderPage.assertDisplayedFor(uuid);
      });
    });
  });

  test.describe("writes on the reserved pdf", () => {
    // Every test writes the one reserved pdf, so they run one at a time.
    test.describe.configure({ mode: "default" });

    test("mark an unread pdf reading when it opens", async ({
      pdfReaderPage,
      request,
      parkBook,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book unread on page 1", async () => {
        await parkBook(uuid, pdfPageAnchor(0), "unread");
      });

      // The write fires once the page load and its fetches settle.
      await test.step("open the book", async () => {
        await expectMutation(readStatus.setOnOpen(uuid, "reading"), () =>
          pdfReaderPage.goto(uuid),
        );
      });
    });

    test("save the position on every page turn", async ({
      pdfReaderPage,
      request,
      parkBook,
      expectMutation,
      storedPosition,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 1", async () => {
        await parkBook(uuid, pdfPageAnchor(0), "reading");
      });

      const count = await test.step("open the book", async () => {
        await pdfReaderPage.goto(uuid);
        const pages = await pdfReaderPage.pageCount();
        expect(pages, "page count from the label").toBeGreaterThan(4);
        return pages;
      });

      await test.step("turn three pages", async () => {
        for (let target = 1; target <= 3; target++) {
          await expectMutation(
            progress.savePage(
              uuid,
              pdfPageAnchor(target),
              pagePercent(target, count),
            ),
            () => pdfReaderPage.turnPage(),
          );
          await expect(pdfReaderPage.pageLabel).toHaveText(
            `Page ${target + 1} of ${count}`,
          );
        }
      });

      await test.step("check the server holds page 4", async () => {
        const record = await storedPosition(uuid);
        expect(record?.epub_cfi).toBe("pdf-page:3");
        expect(record?.progress_percent).toBe(Math.round(400 / count));
      });
    });

    test("open a pdf on its saved page", async ({
      pdfReaderPage,
      request,
      parkBook,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 4", async () => {
        await parkBook(uuid, pdfPageAnchor(3), "reading");
      });

      await test.step("open the book", async () => {
        await pdfReaderPage.goto(uuid);
      });

      await test.step("check the reader restored page 4", async () => {
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 4 of \d+$/);
      });
    });

    test("mark a pdf finished on reaching its last page", async ({
      pdfReaderPage,
      request,
      parkBook,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 4", async () => {
        await parkBook(uuid, pdfPageAnchor(3), "reading");
      });

      const count = await test.step("open the book", async () => {
        await pdfReaderPage.goto(uuid);
        return pdfReaderPage.pageCount();
      });

      // The position saves, and the last page marks the book finished.
      await test.step("slide to the last page", async () => {
        await expectMutation(readStatus.set(uuid, "finished"), () =>
          expectMutation(progress.save(), () =>
            pdfReaderPage.slideToPage(count - 1),
          ),
        );
      });

      await test.step("check the reader is on the last page", async () => {
        await expect(pdfReaderPage.pageLabel).toHaveText(
          `Page ${count} of ${count}`,
        );
        await expect(pdfReaderPage.nextPageButton).toBeDisabled();
      });
    });

    test("keep a finished pdf finished when paging back", async ({
      pdfReaderPage,
      request,
      parkBook,
      expectMutation,
      storedReadStatus,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      // The page count is PDF.js's, so the park cannot name the last page.
      await test.step("park the book finished on page 4", async () => {
        await parkBook(uuid, pdfPageAnchor(3), "finished");
      });

      const count = await test.step("open the book", async () => {
        await pdfReaderPage.goto(uuid);
        return pdfReaderPage.pageCount();
      });

      await test.step("slide to the last page", async () => {
        await expectMutation(progress.save(), () =>
          pdfReaderPage.slideToPage(count - 1),
        );
      });

      await test.step("slide back to the first page", async () => {
        await expectMutation(progress.save(), () =>
          pdfReaderPage.slideToPage(0),
        );
      });

      // Paging back saves the position but must not downgrade the status.
      await test.step("check the book is still finished", async () => {
        expect(await storedReadStatus(uuid)).toBe("finished");
      });
    });

    test("highlight a text-layer selection", async ({
      pdfReaderPage,
      request,
      parkBook,
      expectMutation,
      seededHighlightIds,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 9", async () => {
        await parkBook(uuid, pdfPageAnchor(8), "reading");
      });

      // Page 9 is real prose: the first pages of the Calibre conversion carry
      // only a page number.
      await test.step("open the book", async () => {
        await pdfReaderPage.goto(uuid);
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 9 of/);
      });

      const selected = await test.step("select a text run", async () => {
        await pdfReaderPage.selectFirstTextRun();
        const text = await pdfReaderPage.selectedText();
        expect(text.length, "selection has text").toBeGreaterThan(0);
        await expect(pdfReaderPage.selectionPopover).toBeVisible();
        return text;
      });

      const { request: saved } =
        await test.step("highlight it green", async () => {
          const created = await expectMutation(highlights.create(), () =>
            pdfReaderPage.highlightSelection("green"),
          );
          const { id } = await created.response.json();
          seededHighlightIds.add(id);
          return created;
        });

      await test.step("check the highlight saved and painted", async () => {
        const sent = sentHighlight(saved);
        expect(sent.color).toBe("green");
        expect(sent.epub_cfi_range).toMatch(SELECTION_RANGE);
        expect(sent.text.trim()).toBe(selected);
        await expect(pdfReaderPage.selectionPopover).toHaveCount(0);
        await expect(
          pdfReaderPage.paintedHighlight(sent.epub_cfi_range, "green"),
        ).not.toHaveCount(0);
      });
    });

    test("paint a saved highlight when its page opens", async ({
      pdfReaderPage,
      request,
      parkBook,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);
      const range = pdfHighlightRange(8);

      await test.step("park the book reading on page 9", async () => {
        await parkBook(uuid, pdfPageAnchor(8), "reading");
      });

      await test.step("save a green highlight on page 9", async () => {
        await highlightOn(uuid, { epub_cfi_range: range, color: "green" });
      });

      await test.step("open the book", async () => {
        await pdfReaderPage.goto(uuid);
      });

      await test.step("check the highlight is painted", async () => {
        await expect(
          pdfReaderPage.paintedHighlight(range, "green"),
        ).not.toHaveCount(0, { timeout: 15_000 });
      });
    });

    test("list a saved highlight in the highlights drawer", async ({
      pdfReaderPage,
      request,
      parkBook,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 1", async () => {
        await parkBook(uuid, pdfPageAnchor(0), "reading");
      });

      const highlight =
        await test.step("save a highlight on page 9", async () => {
          return highlightOn(uuid, { epub_cfi_range: pdfHighlightRange(8) });
        });

      await test.step("open the highlights drawer", async () => {
        await pdfReaderPage.goto(uuid);
        await pdfReaderPage.openHighlights();
        await expect(pdfReaderPage.highlightsDrawer.root).toBeVisible();
      });

      await test.step("check the drawer lists it with its prose", async () => {
        await expect(
          pdfReaderPage.highlightsDrawer.row(highlight.text).root,
        ).toHaveCount(1);
      });
    });

    test("open a saved passage from the book detail page at its page", async ({
      bookDetailPage,
      pdfReaderPage,
      request,
      parkBook,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      // Resume would land on page 1, so landing on page 9 proves the link won.
      await test.step("park the book reading on page 1", async () => {
        await parkBook(uuid, pdfPageAnchor(0), "reading");
      });

      const highlight =
        await test.step("save a highlight on page 9", async () => {
          return highlightOn(uuid, { epub_cfi_range: pdfHighlightRange(8) });
        });

      // The card names the page, or the outline entry covering it.
      const card = bookDetailPage.savedPassageCard(highlight.text);
      await test.step("check the book detail page lists it", async () => {
        await bookDetailPage.goto(uuid);
        await expect(card.root).toHaveCount(1);
        await expect(card.metaText).toContainText(/^.+ · saved /);
        await expect(card.openLink).toHaveAttribute(
          "href",
          `/pdf/${uuid}?page=9`,
        );
      });

      await test.step("open it in the book", async () => {
        await card.openInBook();
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 9 of/, {
          timeout: 20_000,
        });
        await pdfReaderPage.assertDisplayedFor(uuid, 9);
      });
    });

    test("bookmark the current page", async ({
      pdfReaderPage,
      request,
      parkBook,
      expectMutation,
      seededBookmarkIds,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 4", async () => {
        await parkBook(uuid, pdfPageAnchor(3), "reading");
      });

      await test.step("open the bookmarks drawer", async () => {
        await pdfReaderPage.goto(uuid);
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 4 of/);
        await pdfReaderPage.openBookmarks();
        await expect(pdfReaderPage.bookmarksDrawer.root).toBeVisible();
      });

      // "+ Bookmark" stores the page anchor, labelled by the page.
      await test.step("add a bookmark", async () => {
        const { response } = await expectMutation(
          bookmarks.create(pdfPageBookmark(uuid, 3)),
          () => pdfReaderPage.bookmarksDrawer.add(),
        );
        const { id }: SeededBookmark = await response.json();
        seededBookmarkIds.add(id);
      });

      await test.step("check the drawer lists it", async () => {
        await expect(pdfReaderPage.bookmarksDrawer.row("Page 4")).toHaveCount(
          1,
        );
      });
    });

    test("jump to a bookmarked page", async ({
      pdfReaderPage,
      request,
      parkBook,
      bookmarksRequests,
      expectMutation,
      seededBookmarkIds,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PDF.title);

      await test.step("park the book reading on page 1", async () => {
        await parkBook(uuid, pdfPageAnchor(0), "reading");
      });

      await test.step("save a bookmark on page 4", async () => {
        const created = await bookmarksRequests.postBookmark(
          pdfPageBookmark(uuid, 3),
        );
        expect(created.status(), "seed bookmark").toBe(200);
        const { id }: SeededBookmark = await created.json();
        seededBookmarkIds.add(id);
      });

      await test.step("open the bookmarks drawer", async () => {
        await pdfReaderPage.goto(uuid);
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 1 of/);
        await pdfReaderPage.openBookmarks();
        await expect(pdfReaderPage.bookmarksDrawer.root).toBeVisible();
      });

      await test.step("jump to the bookmark", async () => {
        await expectMutation(progress.save(), () =>
          pdfReaderPage.bookmarksDrawer.jumpTo("Page 4"),
        );
      });

      await test.step("check the reader is on page 4", async () => {
        await expect(pdfReaderPage.pageLabel).toHaveText(/^Page 4 of/);
        await expect(pdfReaderPage.bookmarksDrawer.root).toHaveCount(0);
      });
    });
  });
});
