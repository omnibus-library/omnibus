import type { Page } from "@playwright/test";
import { progress } from "../contracts/progress";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { expectMutation, failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { gotoReady } from "../utils/nav";
import { storedProgress } from "../utils/progress";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Both CBZ fixtures are reserved for this spec (see fixtures/epubs.ts), and
// the split matters even within it: the suite is fullyParallel, so the
// write-path test (COMIC, which takes the progress AND read-status writes)
// and the read-only tests (PRISTINE, which assert a page-1 open) can run
// concurrently — a shared book would race.
const COMIC = FIXTURE_BOOKS.find((b) => b.slug === "aurora-station-01")!;
const COMIC_PAGES = 8;
const PRISTINE = FIXTURE_BOOKS.find((b) => b.slug === "aurora-station-02")!;
const PRISTINE_PAGES = 5;

// Re-seed so the running server is indexed against the committed fixtures
// before any assertion runs — independent of other specs in this worker.
//
// Then pre-set PRISTINE to `reading`: the pager auto-marks an unread book
// `reading` on open, so PRISTINE's read-only tests would otherwise fire an
// unasserted status mutation the moment they open it (rule 04). With the
// status pre-set, the open path is mutation-free — the pager fetches the
// status, sees nothing to transition, and writes nothing. beforeAll runs
// once per worker, and concurrent PUTs can hit SQLite's busy timeout while
// the seed reindex is still writing, so converge with a read-then-write
// poll instead of asserting a single PUT.
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
// the sibling `/api/rpc/read-status/get` fetch the pager issues on open.
const READ_STATUS_POST = {
  method: "POST" as const,
  url: "/api/rpc/read-status/set",
  expectedStatus: 200,
};

async function openComic(page: Page, uuid: string) {
  await gotoReady(page, `/comic/${uuid}`);
  // The pager renders its chrome only after the metadata + saved-position
  // fetch resolves; the footer label is the "ready" signal.
  await expect(page.getByTestId("comic-footer")).toBeVisible();
}

function pageLabel(page: Page) {
  return page.getByTestId("comic-footer").locator(".cr-page-label");
}

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
      await expect(comicReaderPage.pageLabel).toHaveText("Page 2 of 5");
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
});

test("pages forward, saves each turn, resumes, and auto-marks reading then finished", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, COMIC.title);

  // Reset the state a previous run left behind — a run that died mid-test
  // never reaches the tail resets, and the leftovers change this test's
  // behavior: a saved position reopens on the last page (auto-finishing on
  // open instead of marking reading), and a leftover finished status never
  // auto-downgrades. Reset both up front so the transitions are
  // deterministic.
  const progressReset = await request.post("/api/progress", {
    data: {
      book_uuid: uuid,
      format: "epub",
      epub_cfi: "comic-page:0",
      progress_percent: Math.round(100 / COMIC_PAGES),
    },
  });
  expect(progressReset.status()).toBe(200);
  const reset = await request.put("/api/read-status", {
    data: { book_uuid: uuid, status: "unread" },
  });
  expect(reset.status()).toBe(200);

  // Opening an unread comic marks it reading, exactly once. The write fires
  // after hydration + the metadata/status fetches settle, so give it the
  // full-page-load allowance.
  await expectMutation(
    page,
    {
      ...READ_STATUS_POST,
      expectedBody: { update: { book_uuid: uuid, status: "reading" } },
      timeout: 15_000,
    },
    async () => openComic(page, uuid),
  );

  // Three forward turns; each must POST the exact page anchor + percent.
  for (let target = 1; target <= 3; target++) {
    const { request: saved } = await expectMutation(
      page,
      {
        ...PROGRESS_POST,
        expectedBody: {
          update: {
            book_uuid: uuid,
            format: "epub",
            epub_cfi: `comic-page:${target}`,
            progress_percent: Math.round(((target + 1) * 100) / COMIC_PAGES),
          },
        },
      },
      async () => page.getByRole("button", { name: "Next page" }).click(),
    );
    void saved;
    await expect(pageLabel(page)).toHaveText(
      `Page ${target + 1} of ${COMIC_PAGES}`,
    );
  }

  // The server now holds the anchor for page index 3.
  const record = await storedProgress(request, uuid);
  expect(record?.epub_cfi).toBe("comic-page:3");
  expect(record?.progress_percent).toBe(50);
  // A comic has no spine to resolve against, so the block reports the percent
  // it does carry rather than inventing a chapter.
  expect(record?.resolved?.percent_through_book).toBe(50);
  expect(record?.resolved?.chapter_title).toBeUndefined();

  // Leave, reopen: the pager restores the saved page, not page 1.
  await gotoReady(page, `/books/${uuid}`);
  await openComic(page, uuid);
  await expect(pageLabel(page)).toHaveText(`Page 4 of ${COMIC_PAGES}`);
  await expect(page.getByTestId("comic-page-image")).toHaveAttribute(
    "src",
    `/api/ebooks/${uuid}/pages/3`,
  );

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
          .fill(String(COMIC_PAGES - 1)),
      ),
  );
  await expect(pageLabel(page)).toHaveText(
    `Page ${COMIC_PAGES} of ${COMIC_PAGES}`,
  );
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

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
