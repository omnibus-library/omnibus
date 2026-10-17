import type { Page } from "@playwright/test";
import { progress } from "../contracts/progress";
import { readStatus } from "../contracts/readStatus";
import { pagePercent, pdfPageAnchor } from "../data/progress";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { buildJpxPdf, JPX_FILL } from "../fixtures/jpx_pdf";
import { expect, test } from "../fixtures/pageFixtures";
import { expectMutation, failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Both PDF fixtures are reserved for this spec (see fixtures/epubs.ts), and
// the split matters even within it: the suite is fullyParallel, so the
// write-path tests (PDF, which takes the progress, read-status, highlight
// and bookmark writes — serialised below) and the read-only tests
// (PRISTINE, which assert a page-1 open) can run concurrently — a shared
// book would race.
const PDF = FIXTURE_BOOKS.find((b) => b.slug === "time-machine")!;
const PRISTINE = FIXTURE_BOOKS.find((b) => b.slug === "flatland")!;

// Re-seed so the running server is indexed against the committed fixtures
// before any assertion runs — independent of other specs in this worker.
//
// Then pre-set PRISTINE to `reading`: the reader auto-marks an unread book
// `reading` on open, so PRISTINE's read-only tests would otherwise fire an
// unasserted status mutation the moment they open it (rule 04). Converge
// with a read-then-write poll — concurrent PUTs can hit SQLite's busy
// timeout while the seed reindex is still writing.
test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
  await expect
    .poll(
      async () => {
        const current = await request.get(`/api/read-status/${uuid}`);
        if (current.status() === 200) {
          const record = (await current.json()) as { status: string } | null;
          if (record?.status === "reading") return "reading";
        }
        await request.put("/api/read-status", {
          data: { book_uuid: uuid, status: "reading" },
        });
        return "pending";
      },
      { timeout: 15_000, intervals: [200, 500, 1_000] },
    )
    .toBe("reading");
});

// Every page turn saves through the shared progress RPC.
const PROGRESS_POST = {
  method: "POST" as const,
  url: /\/api\/rpc\/progress(?:\?|$)/,
  expectedStatus: 200,
};

async function openPdf(page: Page, path: string) {
  await gotoReady(page, path);
  // The glue reports ready once the first page rasterised; the loading
  // overlay leaving and the page label filling in are the "ready" signal.
  await expect(page.getByTestId("pdf-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(pageLabel(page)).toHaveText(/^Page \d+ of \d+$/);
}

function pageLabel(page: Page) {
  return page.getByTestId("pdf-page-label");
}

/**
 * Drag-select the first run of text on the current page's text layer and
 * return the selected prose. PDF.js lays one absolutely positioned span per
 * text run, so a drag from the left edge of a span to past its right edge
 * selects that run.
 */
async function selectFirstTextRun(page: Page): Promise<string> {
  const span = page
    .locator(".pr-textlayer span")
    .filter({ hasText: /\S{3,}/ })
    .first();
  await expect(span).toBeAttached({ timeout: 15_000 });
  const box = await span.boundingBox();
  expect(box, "text run has a box").not.toBeNull();
  const { x, y, width, height } = box!;
  const midY = y + height / 2;
  await page.mouse.move(x + 1, midY);
  await page.mouse.down();
  await page.mouse.move(x + width * 0.5, midY, { steps: 4 });
  await page.mouse.move(x + width - 1, midY, { steps: 4 });
  await page.mouse.up();
  const selected = await page.evaluate(() => String(window.getSelection()));
  expect(selected.trim().length, "selection has text").toBeGreaterThan(0);
  return selected.trim();
}

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
  });
});

// The write-path tests all mutate PDF's rows, so they run one after another
// even though the suite is fullyParallel.
test.describe("writes on the reserved PDF", () => {
  test.describe.configure({ mode: "serial" });

  test("highlights a text-layer selection, paints it on reload, lists it, and deep-links back to its page", async ({
    page,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PDF.title);
    // Land on page 9 (index 8): past the front matter, on real prose — the
    // first pages of the Calibre conversion carry only a page number.
    const positioned = await request.post("/api/progress", {
      data: {
        book_uuid: uuid,
        format: "epub",
        epub_cfi: "pdf-page:8",
        progress_percent: 5,
      },
    });
    expect(positioned.status()).toBe(200);
    await openPdf(page, `/pdf/${uuid}`);
    await expect(pageLabel(page)).toHaveText(/^Page 9 of/);

    // Drag-select on the text layer: the popover offers the swatches.
    const selected = await selectFirstTextRun(page);
    const popover = page.locator(".rd-selection-popover");
    await expect(popover).toBeVisible();

    // Saving POSTs a `pdf:{page}:{quads}` anchor with the selected prose.
    const { request: created } = await expectMutation(
      page,
      {
        method: "POST",
        url: /\/api\/rpc\/highlights\/create(?:\?|$)/,
        expectedStatus: 200,
      },
      async () =>
        popover.getByRole("button", { name: "Highlight green" }).click(),
    );
    const body = created.postDataJSON() as {
      input: { epub_cfi_range: string; color: string; text?: string };
    };
    expect(body.input.color).toBe("green");
    expect(body.input.epub_cfi_range).toMatch(
      /^pdf:8:(-?\d+(\.\d)?,){7}-?\d+(\.\d)?(;(-?\d+(\.\d)?,){7}-?\d+(\.\d)?)*$/,
    );
    expect(body.input.text?.trim()).toBe(selected);
    await expect(popover).toHaveCount(0);

    // Painted on this page, and again after a reload from the stored anchor.
    await expect(page.locator(".pr-hl[data-color='green']")).not.toHaveCount(0);
    await openPdf(page, `/pdf/${uuid}`);
    await expect(page.locator(".pr-hl[data-color='green']")).not.toHaveCount(
      0,
      {
        timeout: 15_000,
      },
    );

    // Listed in the drawer with its prose.
    await page.getByTestId("pdf-highlights").click();
    await expect(page.getByTestId("reader-highlights-drawer")).toBeVisible();
    const row = page
      .getByTestId("reader-highlight-row")
      .filter({ hasText: selected });
    await expect(row).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reader-highlights-drawer")).toHaveCount(0);

    // The book-detail saved-passages card names the page (or the outline
    // entry covering it) and its "open in book" lands on that page.
    await gotoReady(page, `/books/${uuid}`);
    const card = page
      .getByTestId("highlight-card")
      .filter({ hasText: selected });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("highlight-meta")).toContainText(
      /^.+ · saved /,
    );
    const open = card.getByTestId("highlight-open");
    const href = await open.getAttribute("href");
    expect(href).not.toBeNull();
    const linked = new URL(href as string, page.url());
    expect(linked.pathname).toBe(`/pdf/${uuid}`);
    expect(linked.searchParams.get("page")).toBe("9");
    // Move the saved position away first, so landing on page 9 proves the
    // deep link won over resume.
    const moved = await request.post("/api/progress", {
      data: {
        book_uuid: uuid,
        format: "epub",
        epub_cfi: "pdf-page:0",
        progress_percent: 1,
      },
    });
    expect(moved.status()).toBe(200);
    await open.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/pdf/${uuid}` && url.searchParams.get("page") === "9",
    );
    await expect(pageLabel(page)).toHaveText(/^Page 9 of/, { timeout: 20_000 });

    // Clean up the highlight so re-runs start from an empty list.
    const list = await request.get(`/api/highlights/book/${uuid}`);
    expect(list.status()).toBe(200);
    const mine = (
      (await list.json()) as { id: number; text?: string }[]
    ).filter((h) => h.text?.trim() === selected);
    for (const h of mine) {
      expect((await request.delete(`/api/highlights/${h.id}`)).status()).toBe(
        204,
      );
    }
  });

  test("saves a bookmark on the current page and jumps back to it", async ({
    page,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PDF.title);
    const positioned = await request.post("/api/progress", {
      data: {
        book_uuid: uuid,
        format: "epub",
        epub_cfi: "pdf-page:3",
        progress_percent: 5,
      },
    });
    expect(positioned.status()).toBe(200);
    await openPdf(page, `/pdf/${uuid}`);
    await expect(pageLabel(page)).toHaveText(/^Page 4 of/);

    // "+ Bookmark" stores the page anchor, labelled by the page.
    await page.getByTestId("pdf-bookmarks").click();
    await expect(page.getByTestId("reader-bookmarks-drawer")).toBeVisible();
    const { response } = await expectMutation(
      page,
      {
        method: "POST",
        url: /\/api\/rpc\/bookmarks\/create(?:\?|$)/,
        expectedBody: {
          input: {
            client_id: null,
            book_uuid: uuid,
            position: "pdf-page:3",
            title: "Page 4",
          },
        },
        expectedStatus: 200,
      },
      async () => page.getByTestId("reader-bookmark-add").click(),
    );
    const bookmark = (await response.json()) as { id: number };
    const row = page
      .getByTestId("reader-bookmark-row")
      .filter({ hasText: "Page 4" });
    await expect(row).toHaveCount(1);
    await page.keyboard.press("Escape");

    // Move away, then jump back through the bookmark.
    await expectMutation(page, PROGRESS_POST, async () =>
      page.getByRole("slider", { name: "Page slider" }).fill("0"),
    );
    await expect(pageLabel(page)).toHaveText(/^Page 1 of/);
    await page.getByTestId("pdf-bookmarks").click();
    await expectMutation(page, PROGRESS_POST, async () =>
      row.getByRole("button", { name: "Page 4" }).click(),
    );
    await expect(pageLabel(page)).toHaveText(/^Page 4 of/);
    await expect(page.getByTestId("reader-bookmarks-drawer")).toHaveCount(0);

    expect(
      (await request.delete(`/api/bookmarks/${bookmark.id}`)).status(),
    ).toBe(204);
  });
});
