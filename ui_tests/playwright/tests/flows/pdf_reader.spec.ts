import type { Page } from "@playwright/test";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { buildJpxPdf, JPX_FILL } from "../fixtures/jpx_pdf";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { gotoReady } from "../utils/nav";
import { storedProgress } from "../utils/progress";
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

// Automatic read-status transitions (open → reading, last page → finished)
// go through the read-status set RPC. The exact-path string cannot match
// the sibling `/api/rpc/read-status/get` fetch the reader issues on open.
const READ_STATUS_POST = {
  method: "POST" as const,
  url: "/api/rpc/read-status/set",
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

/** The document's page count, as the footer reports it. */
async function pageCount(page: Page): Promise<number> {
  const label = (await pageLabel(page).textContent()) ?? "";
  const match = /of (\d+)$/.exec(label);
  expect(match, `page label "${label}"`).not.toBeNull();
  return Number(match![1]);
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

test("renders the PDF reader layout and opens a pristine book on page 1", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
  await openPdf(page, `/pdf/${uuid}`);

  // Chrome: back, title block, the annotation tools, fit-mode toggle group.
  await expect(page.getByTestId("pdf-back")).toBeVisible();
  await expect(page.getByText(PRISTINE.title)).toBeVisible();
  await expect(page.getByTestId("pdf-highlights")).toBeVisible();
  await expect(page.getByTestId("pdf-bookmarks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit width" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit height" })).toBeVisible();

  // Stage: PDF.js rasterised a canvas and laid its text layer over it —
  // proves the file route served real bytes and the worker ran.
  const canvas = page.locator(".pr-canvas");
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width))
    .toBeGreaterThan(0);
  // The cover is a scan with no text, so the layer is present but empty
  // here; the highlight test drives it on a prose page.
  await expect(page.locator(".pr-textlayer")).toHaveCount(1);

  // Page-turn buttons and the slider; prev is disabled on page 1.
  await expect(
    page.getByRole("button", { name: "Previous page" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  await expect(page.getByRole("slider", { name: "Page slider" })).toBeVisible();
  const count = await pageCount(page);
  expect(count).toBeGreaterThan(1);
  await expect(pageLabel(page)).toHaveText(`Page 1 of ${count}`);
});

test("decodes a JPEG 2000 image through the bundled OpenJPEG module", async ({
  page,
  request,
}) => {
  // PDF.js 6 decodes JPXDecode in a WASM module it fetches from `wasmUrl`;
  // when that is unset (or the folder asset, filename, or MIME type is
  // wrong) it drops the image *silently* and the page paints blank. Serve
  // the pristine book's `/file` route from an in-memory JPX-only PDF so the
  // decoder is exercised — nothing in the seeded library carries JPX.
  const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
  await page.route(`**/api/ebooks/${uuid}/file**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: buildJpxPdf(),
    }),
  );
  const decoder = page.waitForResponse((res) =>
    res.url().includes("/pdfjs-wasm/openjpeg.wasm"),
  );

  await openPdf(page, `/pdf/${uuid}`);
  await expect(pageLabel(page)).toHaveText("Page 1 of 2");

  // The worker asked for the decoder at the bundled directory and the
  // server answered with a WASM body, not a 404 page.
  const res = await decoder;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/wasm");

  // And it decoded: the page is the image, so the canvas centre carries the
  // image's fill rather than the white a dropped image leaves behind.
  const canvas = page.locator(".pr-canvas");
  const centrePixel = () =>
    canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const px = c
        .getContext("2d")!
        .getImageData(
          Math.floor(c.width / 2),
          Math.floor(c.height / 2),
          1,
          1,
        ).data;
      return [px[0]!, px[1]!, px[2]!];
    });
  // A small tolerance: the codestream is lossless, but the canvas is
  // colour-managed on the way to the backing store.
  await expect
    .poll(async () =>
      (await centrePixel()).every((v, i) => Math.abs(v - JPX_FILL[i]!) <= 8),
    )
    .toBe(true);
});

test("fit modes toggle the stage layout class", async ({ page, request }) => {
  const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
  await openPdf(page, `/pdf/${uuid}`);

  const stage = page.getByTestId("pdf-stage");
  // Fit-height is the default.
  await expect(stage).toHaveClass(/cr-fit-height/);
  await expect(
    page.getByRole("button", { name: "Fit height" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Fit width" }).click();
  await expect(stage).toHaveClass(/cr-fit-width/);
  await expect(page.getByRole("button", { name: "Fit width" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The re-render keeps the page painted at the new size.
  await expect(page.locator(".pr-canvas")).toHaveCount(1);
});

// PRISTINE stays progress-free here: the route interception answers the
// save before it reaches the server, so no position is ever stored.
test("a failed progress save leaves the reader usable", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
  await openPdf(page, `/pdf/${uuid}`);
  const before = await pageLabel(page).textContent();

  // Force the save to fail; the turn itself must still render.
  await page.route("**/api/rpc/progress", (route) =>
    route.fulfill({ status: 500, body: "boom" }),
  );
  await expectMutation(
    page,
    { ...PROGRESS_POST, expectedStatus: 500 },
    async () => page.getByRole("button", { name: "Next page" }).click(),
  );
  await expect(pageLabel(page)).not.toHaveText(before ?? "");
  await expect(page.locator(".pr-canvas")).toHaveCount(1);
  await page.unroute("**/api/rpc/progress");
});

test("book detail shows the PDF Start reading CTA for a PDF-only book", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, PRISTINE.title);
  await gotoReady(page, `/books/${uuid}`);

  const cta = page.getByTestId("start-reading-pdf");
  await expect(cta).toBeVisible();
  await expect(page.getByTestId("no-files-disclaimer")).not.toBeVisible();
  await expect(page.getByTestId("action-read-pdf")).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(`/pdf/${uuid}`);
  await expect(pageLabel(page)).toHaveText(/^Page 1 of \d+$/, {
    timeout: 20_000,
  });
});

// The write-path tests all mutate PDF's rows, so they run one after another
// even though the suite is fullyParallel.
test.describe("writes on the reserved PDF", () => {
  test.describe.configure({ mode: "serial" });

  test("pages forward, saves each turn, resumes, and auto-marks reading then finished", async ({
    page,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, PDF.title);

    // Reset the state a previous run left behind — a run that died mid-test
    // never reaches the tail resets, and the leftovers change this test's
    // behavior: a saved position reopens on the last page (auto-finishing on
    // open instead of marking reading), and a leftover finished status never
    // auto-downgrades.
    const progressReset = await request.post("/api/progress", {
      data: {
        book_uuid: uuid,
        format: "epub",
        epub_cfi: "pdf-page:0",
        progress_percent: 1,
      },
    });
    expect(progressReset.status()).toBe(200);
    const reset = await request.put("/api/read-status", {
      data: { book_uuid: uuid, status: "unread" },
    });
    expect(reset.status()).toBe(200);

    // Opening an unread PDF marks it reading, exactly once. The write fires
    // after hydration + the metadata/status fetches settle, so give it the
    // full-page-load allowance.
    await expectMutation(
      page,
      {
        ...READ_STATUS_POST,
        expectedBody: { update: { book_uuid: uuid, status: "reading" } },
        timeout: 20_000,
      },
      async () => openPdf(page, `/pdf/${uuid}`),
    );
    const count = await pageCount(page);
    expect(count).toBeGreaterThan(4);

    // Three forward turns; each must POST the exact page anchor + percent.
    for (let target = 1; target <= 3; target++) {
      await expectMutation(
        page,
        {
          ...PROGRESS_POST,
          expectedBody: {
            update: {
              book_uuid: uuid,
              format: "epub",
              epub_cfi: `pdf-page:${target}`,
              progress_percent: Math.round(((target + 1) * 100) / count),
            },
          },
        },
        async () => page.getByRole("button", { name: "Next page" }).click(),
      );
      await expect(pageLabel(page)).toHaveText(
        `Page ${target + 1} of ${count}`,
      );
    }

    // The server now holds the anchor for page index 3.
    const record = await storedProgress(request, uuid);
    expect(record?.epub_cfi).toBe("pdf-page:3");
    expect(record?.progress_percent).toBe(Math.round(400 / count));

    // Leave, reopen: the reader restores the saved page, not page 1.
    await gotoReady(page, `/books/${uuid}`);
    await openPdf(page, `/pdf/${uuid}`);
    await expect(pageLabel(page)).toHaveText(`Page 4 of ${count}`);

    // The slider jumps to the last page: the position saves, and landing on
    // the final page auto-marks the book finished.
    await expectMutation(
      page,
      {
        ...READ_STATUS_POST,
        expectedBody: { update: { book_uuid: uuid, status: "finished" } },
      },
      async () =>
        expectMutation(page, PROGRESS_POST, async () =>
          page
            .getByRole("slider", { name: "Page slider" })
            .fill(String(count - 1)),
        ),
    );
    await expect(pageLabel(page)).toHaveText(`Page ${count} of ${count}`);
    await expect(
      page.getByRole("button", { name: "Next page" }),
    ).toBeDisabled();

    // Paging back off the last page saves the position but must not
    // downgrade the status: the server still reports finished afterwards.
    await expectMutation(page, PROGRESS_POST, async () =>
      page.getByRole("slider", { name: "Page slider" }).fill("0"),
    );
    const after = await request.get(`/api/read-status/${uuid}`);
    expect(after.status()).toBe(200);
    const statusAfter = (await after.json()) as { status: string } | null;
    expect(statusAfter?.status).toBe("finished");

    // Reset the status for the next run (the page-0 save above already reset
    // the position).
    const cleanup = await request.put("/api/read-status", {
      data: { book_uuid: uuid, status: "unread" },
    });
    expect(cleanup.status()).toBe(200);
  });

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
