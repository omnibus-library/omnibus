import { highlights } from "../contracts/highlights";
import { kindle } from "../contracts/kindle";
import { readStatus } from "../contracts/readStatus";
import {
  AUDIOBOOK_BOOK_COUNT,
  AUDIOBOOK_BOOKS,
  MERGE_ONLY_TITLES,
  MERGE_SECONDARY,
} from "../fixtures/audiobooks";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

// An EPUB-only book with one author, Ada Lovelace.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// `beta` is the first of the "Pioneers" series.
const SERIES_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;

// Niklaus Wirth has four books in FIXTURE_BOOKS (the Code Quartet) — three
// where he's the sole/lead author and one (Quartet III) where he's the lead
// of a multi-author group. `data::get_author` returns every book under the
// primary author's id, so visiting any Wirth book should surface the other
// three under "More by".
const WIRTH_LEAD = FIXTURE_BOOKS.find((b) => b.slug === "code-quartet-1")!;
const WIRTH_OTHERS = FIXTURE_BOOKS.filter(
  (b) => b.authors[0] === "Niklaus Wirth" && b.slug !== WIRTH_LEAD.slug,
);
const SIBLING = FIXTURE_BOOKS.find((b) => b.slug === "code-quartet-2")!;
const LAMARR_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "gamma")!;

// Only this spec opens `standalone-canyon`, so it can write its read status.
const READ_STATUS_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-canyon",
)!;

// Only this spec seeds highlights on `standalone-garden`.
// `shelf_gallery.spec.ts` reads only its progress, so no test here parks the
// book.
const PASSAGES_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-garden",
)!;

// An MP3 with no ebook companion, so Start listening is its primary action.
// It is not in the merge pair, whose picker a merge would falsify.
const SOLO_MP3 = AUDIOBOOK_BOOKS.find(
  (b) =>
    b.format === "MP3" &&
    b.source === "generated" &&
    !MERGE_ONLY_TITLES.includes(b.title),
)!;

// The picker names a file by its label, else by its part number. The merge
// pair's primary file has no label, and a merge labels the file it moves in
// with its source book's title.
const FIRST_PART = "Part 1";
const SECOND_PART = MERGE_SECONDARY.title;

test.describe("book detail page", () => {
  // Its groups share one book each, so they run one at a time in file order.
  test.describe.configure({ mode: "default" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the book detail layout", async ({ bookDetailPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const author = TARGET.authors[0]!;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the hero shows", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
      await bookDetailPage.topNav.assertDisplayed();
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await expect(bookDetailPage.authorsLine).toContainText(author);
      await expect(bookDetailPage.authorLink(author)).toBeVisible();
      await expect(bookDetailPage.heroCover).toBeVisible();
    });

    // Alpha is EPUB-only, so the primary action reads the book.
    await test.step("check the primary action shows", async () => {
      await expect(bookDetailPage.startReadingButton).toBeVisible();
      await expect(bookDetailPage.startReadingButton).toHaveAttribute(
        "href",
        new RegExp(`/read/${uuid}$`),
      );
    });

    await test.step("check the tabs show with the Overview open", async () => {
      await expect(bookDetailPage.tabList).toBeVisible();
      await expect(bookDetailPage.tabs).toHaveCount(4);
      await expect(bookDetailPage.tab("Overview")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(bookDetailPage.shelvesRow).toBeVisible();
    });

    // Its contents depend on a Hardcover key and the external API, so only
    // the section and its heading are checked.
    await test.step("check the suggestions show", async () => {
      await expect(bookDetailPage.suggestions.root).toBeAttached();
      await expect(bookDetailPage.suggestions.heading).toBeVisible();
    });

    // Whether the passages list or the tab's empty note fills the Highlights &
    // Journal tab depends on `journal.spec.ts`, so only the tab is checked.
    await test.step("check each tab's panel shows", async () => {
      await bookDetailPage.openTab("Reviews");
      await expect(bookDetailPage.reviews.starsGroup).toBeVisible();
      await bookDetailPage.openTab("Highlights & Journal");
      await expect(bookDetailPage.journal.tab).toBeVisible();
      await bookDetailPage.openTab("Files & Details");
      await expect(bookDetailPage.formatSwitcher).toBeVisible();
    });
  });

  test.describe("navigation", () => {
    test("open the reader from start reading", async ({
      bookDetailPage,
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // Opening an unread EPUB writes `reading`. That write is the reader's,
      // so this test leaves it unasserted.
      await test.step("start reading", async () => {
        await bookDetailPage.startReading();
        await epubReaderPage.assertDisplayedFor(uuid);
      });
    });

    test("open a book's details from its library table row", async ({
      libraryPage,
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("show the library as a table", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await expect(libraryPage.table.root).toBeVisible();
      });

      // #2350: only the cover cell's link opens details, not the row itself.
      await test.step("open the book from its row", async () => {
        await expect(
          libraryPage.table.openLink(TARGET.slug, TARGET.title),
        ).toBeVisible();
        await libraryPage.table.openBook(TARGET.slug, TARGET.title);
      });

      await test.step("check the book shows", async () => {
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    test("return to the library table view from a book's details", async ({
      libraryPage,
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open a book from the table view", async () => {
        await libraryPage.goto();
        await libraryPage.table.switchTo();
        await expect(libraryPage.table.root).toBeVisible();
        await expect(
          libraryPage.table.openLink(TARGET.slug, TARGET.title),
        ).toBeVisible();
        await libraryPage.table.openBook(TARGET.slug, TARGET.title);
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("return through the top nav", async () => {
        await bookDetailPage.topNav.openLibrary();
      });

      await test.step("check the library shows as a table", async () => {
        await libraryPage.assertDisplayed();
        await expect(libraryPage.table.root).toBeVisible();
      });
    });

    test("return to the library grid from the top nav", async ({
      bookDetailPage,
      libraryPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("return through the top nav", async () => {
        await bookDetailPage.topNav.openLibrary();
      });

      await test.step("check the library shows as a grid", async () => {
        await libraryPage.assertDisplayed();
        await expect(libraryPage.grid).toBeVisible();
      });
    });

    test("open the author page from the authors line", async ({
      bookDetailPage,
      authorPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const author = TARGET.authors[0]!;

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.authorLink(author)).toBeVisible();
      });

      await test.step("open the author", async () => {
        await bookDetailPage.openAuthor(author);
      });

      await test.step("check the author page shows", async () => {
        await authorPage.assertDisplayed();
      });
    });

    // The byline's series brings the book's series fan into view, and its
    // section links on to the series page.
    test("open the series page from the byline's series", async ({
      bookDetailPage,
      seriesPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, SERIES_BOOK.title);
      const series = SERIES_BOOK.series!;

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.seriesLink(series)).toBeVisible();
      });

      await test.step("show the series", async () => {
        await bookDetailPage.openSeries(series);
        await expect(bookDetailPage.seriesShelf).toBeInViewport();
      });

      await test.step("open the series page", async () => {
        await bookDetailPage.openSeriesPage();
      });

      await test.step("check the series page shows", async () => {
        await seriesPage.assertDisplayed();
      });
    });
  });

  test.describe("formats", () => {
    test("list the epub format with its actions", async ({
      bookDetailPage,
      request,
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
      });

      await test.step("check the epub row shows", async () => {
        await expect(bookDetailPage.formatSwitcher).toBeVisible();
        await expect(epubRow.root).toBeVisible();
        await expect(epubRow.root).toHaveAttribute("data-format", "EPUB");
        // The row draws the format as a glyph tile, so the code is in the
        // badge's accessible name rather than its text.
        await expect(epubRow.badge).toHaveAttribute("aria-label", "EPUB");
      });

      await test.step("check the epub actions show", async () => {
        await expect(epubRow.readLink).toBeVisible();
        await expect(epubRow.readLink).toHaveAttribute("href", /\/read\//);
        await expect(epubRow.kindleButton).toBeVisible();
        await expect(epubRow.kindleButton).toBeEnabled();
      });

      // Alpha has no audio file, so no row in the switcher offers Listen.
      await test.step("check no listen action shows", async () => {
        await expect(bookDetailPage.formatListenLinks).toHaveCount(0);
      });
    });

    test("open the export menu with the ebook's exports", async ({
      bookDetailPage,
      request,
    }) => {
      const { exportMenu } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
      });

      await test.step("check the menu starts closed", async () => {
        await expect(exportMenu.triggerButton).toBeVisible();
        await expect(exportMenu.panel).toBeHidden();
      });

      await test.step("open the menu", async () => {
        await exportMenu.open();
        await expect(exportMenu.panel).toBeVisible();
      });

      await test.step("check the ebook exports show", async () => {
        await expect(exportMenu.downloadEpubLink).toHaveAttribute(
          "href",
          /\/api\/ebooks\/.+\/download$/,
        );
        await expect(exportMenu.downloadEpubLink).toHaveAttribute("download");
        await expect(exportMenu.sendToKindleButton).toBeVisible();
        await expect(exportMenu.sendToKindleButton).toBeEnabled();
        await expect(exportMenu.sendToKoboButton).toBeVisible();
        await expect(exportMenu.sendToKoboButton).toBeEnabled();
      });

      await test.step("check no audiobook download shows", async () => {
        await expect(exportMenu.downloadAudiobookLink).toHaveCount(0);
      });
    });

    test("close the export menu by clicking outside it", async ({
      bookDetailPage,
      request,
    }) => {
      const { exportMenu } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the menu", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
        await exportMenu.open();
        await expect(exportMenu.panel).toBeVisible();
      });

      await test.step("click outside it", async () => {
        await exportMenu.closeByClickingOutside();
      });

      await test.step("check the menu closed", async () => {
        await expect(exportMenu.panel).toBeHidden();
      });
    });

    test("download a kobo copy named by the book's uuid", async ({
      bookDetailPage,
      request,
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book without a directory picker", async () => {
        await bookDetailPage.presetNoDirectoryPicker();
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
        await expect(epubRow.koboButton).toBeVisible();
        await expect(epubRow.koboButton).toBeEnabled();
      });

      const downloads = bookDetailPage.recordDownloads();

      await test.step("send it to kobo", async () => {
        await epubRow.sendToKobo();
      });

      // The stem is the book uuid, which the USB import relies on. The
      // extension is `.kepub.epub` when kepubify converts and `.epub` if not.
      await test.step("check the download is named by the uuid", async () => {
        await expect
          .poll(() => downloads[0], {
            message: "kobo download name",
            timeout: 30_000,
          })
          .toMatch(new RegExp(`^${uuid}\\.(kepub\\.)?epub$`));
      });
    });

    test("send the epub to kindle", async ({
      bookDetailPage,
      request,
      expectMutation,
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book with kindle sends answered", async () => {
        await bookDetailPage.stubKindleSend({ status: "sent" });
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
        await expect(epubRow.kindleButton).toBeEnabled();
      });

      await test.step("send it to kindle", async () => {
        await expectMutation(kindle.send(uuid), () => epubRow.sendToKindle());
      });

      await test.step("check the send reports success", async () => {
        await expect(epubRow.kindleSendStatus).toHaveText(
          "Sent to your Kindle.",
        );
        await expect(epubRow.kindleSendStatus).toHaveClass(/success/);
      });
    });

    test("show an error when a kindle send fails", async ({
      bookDetailPage,
      request,
      expectMutation,
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book with kindle sends failing", async () => {
        await bookDetailPage.stubKindleSend({
          status: "failed",
          message: "SMTP delivery failed",
        });
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
      });

      await test.step("send it to kindle", async () => {
        await expectMutation(kindle.send(uuid), () => epubRow.sendToKindle());
      });

      await test.step("check the send reports the failure", async () => {
        await expect(epubRow.kindleSendStatus).toHaveClass(/error/);
        await expect(epubRow.kindleSendStatus).toContainText(
          "SMTP delivery failed",
        );
      });
    });

    test("dismiss a failed kindle send's error", async ({
      bookDetailPage,
      request,
      expectMutation,
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book with kindle sends failing", async () => {
        await bookDetailPage.stubKindleSend({
          status: "failed",
          message: "SMTP delivery failed",
        });
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Files & Details");
      });

      await test.step("send it to kindle", async () => {
        await expectMutation(kindle.send(uuid), () => epubRow.sendToKindle());
        await expect(epubRow.kindleSendStatus).toHaveClass(/error/);
      });

      // An error toast stays up until dismissed, unlike the success toast.
      await test.step("dismiss the error", async () => {
        await epubRow.dismissKindleToast();
        await expect(epubRow.kindleSendStatus).toHaveCount(0);
      });
    });
  });

  test.describe("more by the author", () => {
    test("show the author's other books", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the row shows", async () => {
        await expect(bookDetailPage.fromSameHandHeading).toBeVisible();
        await expect(bookDetailPage.fromSameHandRow).toBeVisible();
      });

      // The page drops the book's own tile, so only the others show.
      await test.step("check the row holds the other books", async () => {
        await expect(bookDetailPage.fromSameHandTiles).toHaveCount(
          WIRTH_OTHERS.length,
        );
        await expect(
          bookDetailPage.fromSameHandCover(WIRTH_LEAD.title),
        ).toHaveCount(0);
      });
    });

    test("open another book by the author from its cover", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);
      const siblingUuid = await fetchBookUuidByTitle(request, SIBLING.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.fromSameHandRow).toBeVisible();
      });

      await test.step("open a sibling from the row", async () => {
        await bookDetailPage.openSameHandBook(SIBLING.title);
      });

      await test.step("check the sibling shows", async () => {
        await bookDetailPage.assertDisplayedFor(siblingUuid);
      });
    });

    // Hedy Lamarr is single-book across both libraries. Ada Lovelace is not,
    // since the audiobook seed gives her a second book.
    test("show the empty state for an author's only book", async ({
      bookDetailPage,
      request,
    }) => {
      test.fixme(
        true,
        "Parity gap: React's More by row draws nothing for an author's only book, not an empty state",
      );
      const uuid = await fetchBookUuidByTitle(request, LAMARR_BOOK.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the empty state shows", async () => {
        await expect(bookDetailPage.fromSameHandHeading).toBeVisible();
        await expect(bookDetailPage.fromSameHandEmptyMessage).toBeVisible();
        await expect(bookDetailPage.fromSameHandRow).toHaveCount(0);
      });
    });

    // #2478: the block called itself the only book by its author while the
    // author fetch was still in flight.
    test("show a loading note until the author's books load", async ({
      bookDetailPage,
      request,
    }) => {
      test.fixme(
        true,
        "Parity gap: React's More by row draws nothing while the author's books load, not a loading note",
      );
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      const release = await test.step("hold the author fetch", async () => {
        return bookDetailPage.holdAuthorFetch();
      });

      await test.step("open the book", async () => {
        await bookDetailPage.gotoUnsettled(uuid);
      });

      await test.step("check the section says it is still looking", async () => {
        await expect(bookDetailPage.fromSameHandLoadingMessage).toBeVisible();
        await expect(bookDetailPage.fromSameHandEmptyMessage).toHaveCount(0);
      });

      await test.step("let the fetch land", async () => {
        release();
      });

      await test.step("check the row replaces the note", async () => {
        await expect(bookDetailPage.fromSameHandRow).toBeVisible();
        await expect(bookDetailPage.fromSameHandLoadingMessage).toHaveCount(0);
      });
    });
  });

  // Read status outlives a test, so the ones that rely on it park it first.
  test.describe("read status", () => {
    test("show the read status control with its three statuses", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      const control = bookDetailPage.readStatus;

      await test.step("check the control shows", async () => {
        await expect(control.root).toBeVisible();
        await expect(control.pill).toBeEnabled();
      });

      await test.step("open its menu", async () => {
        await control.openMenu();
      });

      await test.step("check the menu offers the three statuses", async () => {
        await expect(control.option("unread")).toBeVisible();
        await expect(control.option("reading")).toBeVisible();
        await expect(control.option("finished")).toBeVisible();
      });
    });

    test("mark a book finished", async ({
      bookDetailPage,
      request,
      presetReadStatus,
      storedReadStatus,
      expectMutation,
    }) => {
      const control = bookDetailPage.readStatus;
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);

      await test.step("park the book unread", async () => {
        await presetReadStatus(uuid, "unread");
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("mark it finished", async () => {
        await expectMutation(readStatus.set(uuid, "finished"), () =>
          control.mark("finished"),
        );
      });

      await test.step("check the control shows finished", async () => {
        await expect(control.pill).toHaveAccessibleName(
          "Read status: Finished",
        );
      });

      await test.step("check the server stored finished", async () => {
        await expect
          .poll(() => storedReadStatus(uuid), { message: "stored status" })
          .toBe("finished");
      });
    });

    test("show the saved read status when the book opens", async ({
      bookDetailPage,
      request,
      presetReadStatus,
    }) => {
      const control = bookDetailPage.readStatus;
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);

      await test.step("park the book finished", async () => {
        await presetReadStatus(uuid, "finished");
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the control shows finished", async () => {
        await expect(control.pill).toHaveAccessibleName(
          "Read status: Finished",
        );
      });
    });

    test("mark a finished book unread", async ({
      bookDetailPage,
      request,
      presetReadStatus,
      storedReadStatus,
      expectMutation,
    }) => {
      const control = bookDetailPage.readStatus;
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);

      await test.step("park the book finished", async () => {
        await presetReadStatus(uuid, "finished");
      });

      // The pill names the parked status only once the saved one has loaded.
      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(control.pill).toHaveAccessibleName(
          "Read status: Finished",
        );
      });

      await test.step("mark it unread", async () => {
        await expectMutation(readStatus.set(uuid, "unread"), () =>
          control.mark("unread"),
        );
      });

      await test.step("check the control shows unread", async () => {
        await expect(control.pill).toHaveAccessibleName("Read status: Unread");
      });

      await test.step("check the server stored unread", async () => {
        await expect
          .poll(() => storedReadStatus(uuid), { message: "stored status" })
          .toBe("unread");
      });
    });

    test("mark an unread book reading", async ({
      bookDetailPage,
      request,
      presetReadStatus,
      storedReadStatus,
      expectMutation,
    }) => {
      const control = bookDetailPage.readStatus;
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);

      await test.step("park the book unread", async () => {
        await presetReadStatus(uuid, "unread");
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("mark it reading", async () => {
        await expectMutation(readStatus.set(uuid, "reading"), () =>
          control.mark("reading"),
        );
      });

      await test.step("check the control shows reading", async () => {
        await expect(control.pill).toHaveAccessibleName("Read status: Reading");
      });

      await test.step("check the server stored reading", async () => {
        await expect
          .poll(() => storedReadStatus(uuid), { message: "stored status" })
          .toBe("reading");
      });
    });

    test("keep the read status when its save fails", async ({
      bookDetailPage,
      request,
      presetReadStatus,
      expectMutation,
    }) => {
      const control = bookDetailPage.readStatus;
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);

      await test.step("park the book reading", async () => {
        await presetReadStatus(uuid, "reading");
      });

      await test.step("open the book while saves fail", async () => {
        await bookDetailPage.goto(uuid);
        await expect(control.pill).toHaveAccessibleName("Read status: Reading");
        await bookDetailPage.forceServerError(readStatus.set(uuid, "finished"));
      });

      await test.step("mark it finished", async () => {
        await expectMutation(failing(readStatus.set(uuid, "finished")), () =>
          control.mark("finished"),
        );
      });

      // The optimistic pick rolls back and a toast says so.
      await test.step("check the control still shows reading", async () => {
        await expect(control.pill).toHaveAccessibleName("Read status: Reading");
        await expect(control.failureToast).toBeVisible();
      });

      await test.step("stop failing saves", async () => {
        await bookDetailPage.stopForcingServerError(
          readStatus.set(uuid, "finished"),
        );
      });

      await test.step("mark it finished again", async () => {
        await expectMutation(readStatus.set(uuid, "finished"), () =>
          control.mark("finished"),
        );
      });

      await test.step("check the control shows finished", async () => {
        await expect(control.pill).toHaveAccessibleName(
          "Read status: Finished",
        );
      });
    });
  });

  test.describe("saved passages", () => {
    // Passages outlive a test, so each starts from none and seeds its own.
    test.beforeEach(
      "clear the book's saved passages",
      async ({ request, sweepHighlights }) => {
        const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
        await sweepHighlights(uuid);
      },
    );

    test("list a saved passage with its locator, note and date", async ({
      bookDetailPage,
      request,
      highlightOn,
      highlightsRequests,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);

      const passage =
        await test.step("save a passage with a note", async () => {
          const seeded = await highlightOn(uuid, {
            epub_cfi_range: "epubcfi(/6/14[chap03]!/4/2,/1:0,/1:40)",
          });
          const noted = await highlightsRequests.patchHighlightNote(
            seeded.id,
            "the line that stuck",
          );
          expect(noted.status(), "seed highlight note").toBe(204);
          return seeded;
        });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
      });

      // The locator names the chapter's TOC title once the book's structure is
      // known (#2463) and the raw spine section until then (#2356), so only
      // its shape is asserted. The date is the server's `created_at`.
      await test.step("check the passage shows", async () => {
        const card = bookDetailPage.savedPassageCard(passage.text);
        await expect(bookDetailPage.savedPassagesEmptyMessage).toHaveCount(0);
        await expect(card.root).toHaveCount(1);
        await expect(card.noteText).toHaveText("the line that stuck");
        await expect(card.metaText).toHaveText(/^.+ · .+$/);
      });
    });

    test("delete a saved passage", async ({
      bookDetailPage,
      request,
      highlightOn,
      seededHighlightIds,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const passage = await highlightOn(uuid);
      const card = bookDetailPage.savedPassageCard(passage.text);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
      });

      await test.step("delete the passage", async () => {
        await card.startDelete();
        await expectMutation(highlights.delete(), () => card.confirmDelete());
        seededHighlightIds.delete(passage.id);
      });

      await test.step("check the list is empty", async () => {
        await expect(card.root).toHaveCount(0);
        await expect(bookDetailPage.savedPassagesEmptyMessage).toBeVisible();
      });
    });

    test("keep a saved passage listed when its delete fails", async ({
      bookDetailPage,
      request,
      highlightOn,
      seededHighlightIds,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const passage = await highlightOn(uuid);
      const card = bookDetailPage.savedPassageCard(passage.text);

      await test.step("open the book while deletes fail", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
        await expect(card.root).toHaveCount(1);
        await bookDetailPage.forceServerError(highlights.delete());
      });

      await test.step("delete the passage", async () => {
        await card.startDelete();
        await expectMutation(failing(highlights.delete()), () =>
          card.confirmDelete(),
        );
      });

      // The row is only dropped once the server confirms, and the confirm
      // stays open with the reason.
      await test.step("check the passage is still listed", async () => {
        await expect(card.root).toHaveCount(1);
        await expect(card.deleteError).toBeVisible();
      });

      await test.step("stop failing deletes", async () => {
        await bookDetailPage.stopForcingServerError(highlights.delete());
      });

      await test.step("delete the passage again from the open confirm", async () => {
        await expectMutation(highlights.delete(), () => card.confirmDelete());
        seededHighlightIds.delete(passage.id);
      });

      await test.step("check the passage is gone", async () => {
        await expect(card.root).toHaveCount(0);
      });
    });

    // Opening an unread EPUB writes `reading`. That write is the reader's, so
    // this test leaves it unasserted.
    test("open the reader at a saved passage", async ({
      bookDetailPage,
      epubReaderPage,
      request,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const cfi = "epubcfi(/6/4!/4/2,/1:0,/1:30)";
      const passage = await highlightOn(uuid, { epub_cfi_range: cfi });
      const card = bookDetailPage.savedPassageCard(passage.text);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
      });

      // The link carries the percent-encoded position, so the reader opens at
      // the passage and not at the saved one. Only the decoded form is checked.
      await test.step("check the passage links to its position", async () => {
        await expect
          .poll(() => card.linkedPassage(), { message: "passage link" })
          .toEqual({ path: `/read/${uuid}`, cfi });
      });

      await test.step("open it in the book", async () => {
        await card.openInBook();
        await epubReaderPage.assertDisplayedFor(uuid, cfi);
      });
    });

    test("open a passage's quote card editor", async ({
      bookDetailPage,
      request,
      highlightOn,
    }) => {
      const { quoteCardModal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const passage = await highlightOn(uuid);
      const card = bookDetailPage.savedPassageCard(passage.text);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
      });

      await test.step("open the quote card editor", async () => {
        await card.openQuoteCard();
      });

      await test.step("check the editor shows the passage", async () => {
        await expect(quoteCardModal.root).toBeVisible();
        await expect(quoteCardModal.heading).toBeVisible();
        await expect(quoteCardModal.root).toContainText(passage.text);
        await expect(quoteCardModal.downloadButton).toBeVisible();
        await expect(quoteCardModal.copyButton).toBeVisible();
      });
    });

    // The controls restyle the preview in place and send no request.
    test("restyle the quote card preview", async ({
      bookDetailPage,
      request,
      highlightOn,
    }) => {
      const { quoteCardModal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const passage = await highlightOn(uuid);

      await test.step("open the quote card editor", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
        await bookDetailPage.savedPassageCard(passage.text).openQuoteCard();
        await expect(quoteCardModal.root).toBeVisible();
      });

      await test.step("pick the sans font", async () => {
        await expect(quoteCardModal.preview).toHaveCSS(
          "font-family",
          /Cormorant Garamond/,
        );
        await quoteCardModal.chooseFont("Sans");
        await expect(quoteCardModal.preview).toHaveCSS(
          "font-family",
          /Instrument Sans/,
        );
      });

      await test.step("toggle italic and bold", async () => {
        await expect(quoteCardModal.previewBody).toHaveCSS(
          "font-style",
          "italic",
        );
        await quoteCardModal.toggleStyle("Italic");
        await expect(quoteCardModal.previewBody).toHaveCSS(
          "font-style",
          "normal",
        );
        await quoteCardModal.toggleStyle("Bold");
        await expect(quoteCardModal.previewBody).toHaveCSS(
          "font-weight",
          "700",
        );
      });

      await test.step("pick the large size", async () => {
        await quoteCardModal.chooseSize("L");
        await expect(quoteCardModal.previewBody).toHaveCSS("font-size", "27px");
      });
    });

    test("close the quote card editor", async ({
      bookDetailPage,
      request,
      highlightOn,
    }) => {
      const { quoteCardModal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const passage = await highlightOn(uuid);
      const card = bookDetailPage.savedPassageCard(passage.text);

      await test.step("open the quote card editor", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
        await card.openQuoteCard();
        await expect(quoteCardModal.root).toBeVisible();
      });

      await test.step("close it", async () => {
        await quoteCardModal.close();
      });

      await test.step("check the passage is still listed", async () => {
        await expect(quoteCardModal.root).toHaveCount(0);
        await expect(card.root).toHaveCount(1);
      });
    });

    test("list every saved passage with no show more control", async ({
      bookDetailPage,
      request,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);

      await test.step("save eight passages", async () => {
        for (let i = 0; i < 8; i++) {
          await highlightOn(uuid, {
            epub_cfi_range: `epubcfi(/6/${4 + i * 2}!/4/2)`,
          });
        }
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.openTab("Highlights & Journal");
      });

      // The tab lists them all rather than holding rows back, so all eight are
      // in the page and nothing offers to load more.
      await test.step("check every passage is listed", async () => {
        await expect(bookDetailPage.savedPassageCards).toHaveCount(8);
        await expect(bookDetailPage.showMorePassagesButton).toHaveCount(0);
      });
    });
  });

  // Last in the file, because its seed adds the audiobooks to the library the
  // earlier groups read.
  test.describe("listening", () => {
    test.beforeAll("seed the audiobook library", async ({ request }) => {
      await seedAudiobookLibrary(
        request,
        audiobookFixturesDir(),
        AUDIOBOOK_BOOK_COUNT,
      );
    });

    test("show start listening with no file picker on a single file audiobook", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, SOLO_MP3.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // #1005: the picker appears only once a book has more than one file of
      // the format the action opens.
      await test.step("check start listening shows without a picker", async () => {
        await expect(bookDetailPage.startListeningButton).toBeVisible();
        await expect(bookDetailPage.startListeningButton).toHaveAttribute(
          "href",
          new RegExp(`/listen/${uuid}$`),
        );
        await expect(bookDetailPage.listenFilePicker.triggerButton).toHaveCount(
          0,
        );
      });
    });

    test("open the listen page from start listening", async ({
      bookDetailPage,
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, SOLO_MP3.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("start listening", async () => {
        await bookDetailPage.startListening();
        await listenPage.assertDisplayedFor(uuid);
      });
    });

    test("show a file picker for an audiobook with two files", async ({
      bookDetailPage,
      mergedAudiobook,
    }) => {
      const { uuid } = mergedAudiobook;
      const picker = bookDetailPage.listenFilePicker;

      await test.step("open the merged book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check start listening offers the picker", async () => {
        await expect(picker.triggerButton).toBeVisible();
        await expect(picker.triggerButton).toHaveText(/Start listening\s*▾/);
        await expect(picker.panel).toHaveCount(0);
      });

      await test.step("open the picker", async () => {
        await picker.open();
        await expect(picker.panel).toBeVisible();
      });

      await test.step("check it lists both files", async () => {
        const firstLink = picker.fileLink(FIRST_PART);
        await expect(picker.heading).toHaveText("2 files · choose one");
        await expect(picker.fileLinks).toHaveCount(2);
        await expect(firstLink).toContainText("Audiobook ·");
        await expect(firstLink).toContainText(/\d+(?:\.\d+)? [KMGT]?B/);
      });
    });

    test("listen to the file picked from the file picker", async ({
      bookDetailPage,
      listenPage,
      mergedAudiobook,
    }) => {
      const {
        uuid,
        audioFileIds: [, secondFile],
      } = mergedAudiobook;
      const picker = bookDetailPage.listenFilePicker;

      await test.step("open the merged book's picker", async () => {
        await bookDetailPage.goto(uuid);
        await picker.open();
      });

      const manifests = picker.recordManifestRequests();

      await test.step("pick the second file", async () => {
        await picker.pick(SECOND_PART);
      });

      await test.step("check the player opens on that file", async () => {
        await expect
          .poll(() => manifests[0], { message: "the manifest the player read" })
          .toMatch(
            new RegExp(
              `/api/audiobooks/${uuid}/manifest\\?file_id=${secondFile}$`,
            ),
          );
        await listenPage.assertDisplayedFor(uuid, secondFile);
      });
    });

    // The app-root player once keyed only on the book's uuid, so re-picking a
    // part of the book already playing kept the first part.
    test("switch to another part of the audiobook already playing", async ({
      bookDetailPage,
      listenPage,
      mergedAudiobook,
    }) => {
      const {
        uuid,
        audioFileIds: [firstFile, secondFile],
      } = mergedAudiobook;
      const picker = bookDetailPage.listenFilePicker;

      // A full page load would void this test, because a reload fetches the
      // manifest again whatever the driver does. The mark must survive it all.
      await test.step("open the merged book", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.markDocument();
      });

      const manifests = picker.recordManifestRequests();

      // The first part's manifest is in before the re-pick, so the last one
      // recorded afterwards can only be the second part's.
      await test.step("play the first part", async () => {
        await picker.open();
        await picker.pick(FIRST_PART);
        await listenPage.assertDisplayedFor(uuid, firstFile);
        await expect
          .poll(() => manifests.length, { message: "the first manifest" })
          .toBeGreaterThan(0);
      });

      await test.step("go back to the book", async () => {
        await bookDetailPage.goBack();
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("open the picker again", async () => {
        await picker.open();
      });

      await test.step("pick the second part", async () => {
        await picker.pick(SECOND_PART);
      });

      await test.step("check the player reboots onto the second part", async () => {
        await expect
          .poll(() => manifests.at(-1), {
            message: "re-pick must reboot onto the second part",
          })
          .toMatch(
            new RegExp(
              `/api/audiobooks/${uuid}/manifest\\?file_id=${secondFile}$`,
            ),
          );
      });

      await test.step("check the pages stayed in the app", async () => {
        expect(
          await bookDetailPage.documentIsMarked(),
          "re-pick nav must stay in-app (no full page load)",
        ).toBe(true);
      });
    });
  });
});
