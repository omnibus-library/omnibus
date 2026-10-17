import type { APIRequestContext } from "@playwright/test";
import { account } from "../contracts/account";
import { kindle } from "../contracts/kindle";
import { ratings } from "../contracts/ratings";
import type { AttributedRating } from "../data/ratings";
import {
  AUDIOBOOK_BOOK_COUNT,
  AUDIOBOOK_BOOKS,
  MERGE_ONLY_TITLES,
  MERGE_PRIMARY,
  MERGE_SECONDARY,
} from "../fixtures/audiobooks";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { expectMutation, failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { withLock } from "../utils/lock";
import { gotoReady } from "../utils/nav";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

// Force serial mode for this file. The audiobook re-seed inside the
// `describe("audiobook-only seed", …)` block below mutates shared server
// state (re-points the library at the audiobook fixtures), so it must
// not race the ebook-seeded tests above — `playwright.config.ts` runs
// with `fullyParallel: true`, which otherwise interleaves them.
test.describe.configure({ mode: "serial" });

// Re-seed in this spec's beforeAll so the running server is indexed against
// the committed EPUB fixtures before any assertion runs — independent of
// whatever other specs in the same worker did before us. The audiobook
// library is seeded in a separate beforeAll (sharded by test.describe) so the
// listen-CTA test gets MP3/M4B-only books to land on.
test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

// An EPUB-only book with one author, Ada Lovelace.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// The dot rail and the back to the book pill mark themselves with this class.
const ON_CLASS = /\bon\b/;

// `beta` is the first of the "Pioneers" series.
const SERIES_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;

// Niklaus Wirth has four books in FIXTURE_BOOKS (the Code Quartet) — three
// where he's the sole/lead author and one (Quartet III) where he's the lead
// of a multi-author group. `data::get_author` returns every book under the
// primary author's id, so visiting any Wirth book should surface the other
// three under "From the same hand".
const WIRTH_LEAD = FIXTURE_BOOKS.find((b) => b.slug === "code-quartet-1")!;
const WIRTH_OTHERS = FIXTURE_BOOKS.filter(
  (b) => b.authors[0] === "Niklaus Wirth" && b.slug !== WIRTH_LEAD.slug,
);
const SIBLING = FIXTURE_BOOKS.find((b) => b.slug === "code-quartet-2")!;
const SOLO = FIXTURE_BOOKS.find((b) => b.slug === "gamma")!;

// Reserved for the read/unread-status tests: read state is per-(user, book)
// server state, so this book must be read by no other spec. `standalone-canyon`
// (Annie Easley) appears in no other flow.
const READ_STATUS_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-canyon",
)!;

// Reserved for the saved-passages tests: highlights are per-(user, book)
// server state, so seeding one here must not disturb another spec's counts.
// `standalone-garden` is read by no other flow, and the reader spec's own
// highlight books (beta / gamma / pioneers-3) stay untouched.
const PASSAGES_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-garden",
)!;

test.describe("book detail page", () => {
  // Its groups share the admin's scroll stops preference and one book each,
  // so they run one at a time in file order.
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
      await expect(bookDetailPage.rating.starsGroup).toBeVisible();
    });

    // Alpha is EPUB-only, so the primary action reads the book.
    await test.step("check the primary action shows", async () => {
      await expect(bookDetailPage.startReadingButton).toBeVisible();
      await expect(bookDetailPage.startReadingButton).toHaveAttribute(
        "href",
        new RegExp(`/read/${uuid}$`),
      );
    });

    await test.step("check the dot rail shows", async () => {
      await expect(bookDetailPage.sectionsNav).toBeVisible();
      await expect(bookDetailPage.sectionDots).toHaveCount(6);
      await expect(bookDetailPage.sectionDot("Home")).toHaveClass(ON_CLASS);
    });

    // The saved passages stop always renders, but whether its list or its
    // empty state fills it depends on `journal.spec.ts`, so only the stop is
    // checked here.
    await test.step("check the stops show", async () => {
      await expect(bookDetailPage.savedPassagesHeading).toBeVisible();
      await expect(bookDetailPage.savedPassagesSection).toBeVisible();
      await expect(bookDetailPage.moreStop).toBeAttached();
      await expect(bookDetailPage.fromSameHandHeading).toBeVisible();
    });

    // Its contents depend on a Hardcover key and the external API, so only
    // the section and its heading are checked.
    await test.step("check the suggestions show", async () => {
      await expect(bookDetailPage.suggestionsStrip).toBeAttached();
      await expect(bookDetailPage.suggestionsHeading).toBeVisible();
    });
  });

  test.describe("scroll stops", () => {
    // The preference is per account and outlives a test, so each sets it first.
    test("read the panel as one continuous flow by default", async ({
      bookDetailPage,
      request,
      presetScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops off through the api", async () => {
        await presetScrollStops(false);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the flow replaces the marquee", async () => {
        await expect(bookDetailPage.flowScroller).toBeAttached();
        await expect(bookDetailPage.snapScroller).toHaveCount(0);
        await expect(bookDetailPage.flowSections).toHaveCount(6);
      });

      // The first section is the book itself, headed by its own title, so only
      // the five after it are introduced by a rule.
      await test.step("check each later section has a rule", async () => {
        await expect(bookDetailPage.leadFlowSection).toHaveCount(1);
        await expect(bookDetailPage.leadFlowSectionLabels).toHaveCount(0);
        await expect(bookDetailPage.flowSectionLabels).toHaveCount(5);
        await expect(bookDetailPage.flowSectionLabels).toContainText([
          "Stats",
          "Highlights",
          "Journals",
          "The files",
          "More",
        ]);
      });

      // Nothing snaps, so the per-stop "scroll, next" cue has no meaning.
      await test.step("check no snap cues show", async () => {
        await expect(bookDetailPage.nextStopCues).toHaveCount(0);
      });
    });

    test("drift the cover as the flow scrolls", async ({
      bookDetailPage,
      request,
      presetScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops off through the api", async () => {
        await presetScrollStops(false);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("scroll the flow", async () => {
        await bookDetailPage.scrollFlowTo(900);
      });

      await test.step("check the cover drifts", async () => {
        await expect
          .poll(() => bookDetailPage.coverTransform(), {
            message: "cover transform after the flow scrolls",
          })
          .toMatch(/translateY/);
      });
    });

    test("show the back to the book pill once the top scrolls away", async ({
      bookDetailPage,
      request,
      presetScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops off through the api", async () => {
        await presetScrollStops(false);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the pill is hidden at the top", async () => {
        await expect(bookDetailPage.backToBookButton).toBeAttached();
        await expect(bookDetailPage.backToBookButton).not.toHaveClass(ON_CLASS);
      });

      await test.step("scroll the top out of sight", async () => {
        await bookDetailPage.scrollFlowTo(900);
        await expect(bookDetailPage.backToBookButton).toHaveClass(ON_CLASS);
      });
    });

    test("scroll back to the top with the back to the book pill", async ({
      bookDetailPage,
      request,
      presetScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops off through the api", async () => {
        await presetScrollStops(false);
      });

      await test.step("scroll the top out of sight", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.scrollFlowTo(900);
        await expect(bookDetailPage.backToBookButton).toHaveClass(ON_CLASS);
      });

      await test.step("go back to the book", async () => {
        await bookDetailPage.backToBook();
      });

      await test.step("check the flow is back at the top", async () => {
        await expect
          .poll(() => bookDetailPage.flowScrollTop(), {
            message: "flow scroll position after the pill",
          })
          .toBe(0);
        await expect(bookDetailPage.backToBookButton).not.toHaveClass(ON_CLASS);
      });
    });

    test("switch to the marquee from settings without a reload", async ({
      bookDetailPage,
      settingsPage,
      libraryPage,
      request,
      presetScrollStops,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops off through the api", async () => {
        await presetScrollStops(false);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.flowScroller).toBeAttached();
      });

      await test.step("turn scroll stops on in settings", async () => {
        await settingsPage.goto("account");
        await expectMutation(account.setScrollStops(true), () =>
          settingsPage.toggleScrollStops(),
        );
      });

      await test.step("return to the book through the library", async () => {
        await settingsPage.topNav.openLibrary();
        await libraryPage.openBookFromGrid(TARGET.title);
      });

      // The save refreshes the app-wide viewer, so the marquee is already in
      // place with no reload.
      await test.step("check the marquee replaces the flow", async () => {
        await expect(bookDetailPage.snapScroller).toBeAttached();
        await expect(bookDetailPage.flowScroller).toHaveCount(0);
      });
    });

    test("track the active stop as the marquee scrolls", async ({
      bookDetailPage,
      request,
      presetScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops on through the api", async () => {
        await presetScrollStops(true);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.snapScroller).toBeAttached();
      });

      // The first paint is the flow, and the marquee replaces it once the
      // viewer resolves. The glue must follow that swap, or the rail goes dead.
      await test.step("scroll the marquee to the journals stop", async () => {
        await bookDetailPage.scrollMarqueeToStop("Journals");
      });

      await test.step("check the dot rail follows", async () => {
        await expect(bookDetailPage.sectionDot("Journals")).toHaveClass(
          ON_CLASS,
        );
        await expect(bookDetailPage.sectionDot("Home")).not.toHaveClass(
          ON_CLASS,
        );
      });
    });

    test("show the snap stop marquee when scroll stops are on", async ({
      bookDetailPage,
      request,
      presetScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("turn scroll stops on through the api", async () => {
        await presetScrollStops(true);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the marquee replaces the flow", async () => {
        await expect(bookDetailPage.snapScroller).toBeAttached();
        await expect(bookDetailPage.flowScroller).toHaveCount(0);
        await expect(bookDetailPage.snapSections).toHaveCount(6);
        await expect(bookDetailPage.backToBookButton).toHaveCount(0);
      });

      await test.step("check the dot rail is the same", async () => {
        await expect(bookDetailPage.sectionDots).toHaveCount(6);
      });
    });
  });

  test.describe("dot rail", () => {
    // The rail works in both modes, so these leave the preference alone.
    test("jump to a stop from the dot rail", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("jump to the files stop", async () => {
        await bookDetailPage.jumpToSection("The files");
      });

      await test.step("check the stop's content is in view", async () => {
        await expect(bookDetailPage.formatSwitcher).toBeInViewport();
      });
    });

    test("mark the jumped-to stop on the dot rail", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("jump to the files stop", async () => {
        await bookDetailPage.jumpToSection("The files");
      });

      // The scroll is smooth, so the marker moves a moment after the click.
      await test.step("check the rail marks the files stop", async () => {
        await expect(bookDetailPage.sectionDot("The files")).toHaveClass(
          ON_CLASS,
        );
        await expect(bookDetailPage.sectionDot("Home")).not.toHaveClass(
          ON_CLASS,
        );
      });
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
        await libraryPage.switchToTableView();
        await expect(libraryPage.bookTable).toBeVisible();
      });

      // #2350: only the cover cell's link opens details, not the row itself.
      await test.step("open the book from its row", async () => {
        await expect(libraryPage.tableDetailsLink(TARGET.title)).toBeVisible();
        await libraryPage.openBookFromTable(TARGET.title);
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
        await libraryPage.switchToTableView();
        await expect(libraryPage.bookTable).toBeVisible();
        await expect(libraryPage.tableDetailsLink(TARGET.title)).toBeVisible();
        await libraryPage.openBookFromTable(TARGET.title);
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("return through the top nav", async () => {
        await bookDetailPage.topNav.openLibrary();
      });

      await test.step("check the library shows as a table", async () => {
        await libraryPage.assertDisplayed();
        await expect(libraryPage.bookTable).toBeVisible();
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
        await expect(libraryPage.bookGrid).toBeVisible();
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

    test("open the series page from the series kicker", async ({
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

      await test.step("open the series", async () => {
        await bookDetailPage.openSeries(series);
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
      });

      await test.step("check the menu starts closed", async () => {
        await expect(exportMenu.triggerButton).toBeVisible();
        await expect(exportMenu.panel).toHaveCount(0);
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
        await exportMenu.open();
        await expect(exportMenu.panel).toBeVisible();
      });

      await test.step("click outside it", async () => {
        await exportMenu.closeByClickingOutside();
      });

      await test.step("check the menu closed", async () => {
        await expect(exportMenu.panel).toHaveCount(0);
      });
    });

    test("send a book to kobo as a uuid named download", async ({
      bookDetailPage,
      request,
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book without a directory picker", async () => {
        await bookDetailPage.presetNoDirectoryPicker();
        await bookDetailPage.goto(uuid);
        await expect(epubRow.koboButton).toBeVisible();
        await expect(epubRow.koboButton).toBeEnabled();
      });

      // The stem is the book uuid, which the USB import relies on. The
      // extension is `.kepub.epub` when kepubify converts and `.epub` if not.
      await test.step("send it to kobo", async () => {
        const download = await epubRow.sendToKobo();
        expect(download.suggestedFilename()).toMatch(
          new RegExp(`^${uuid}\\.(kepub\\.)?epub$`),
        );
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
    }) => {
      const epubRow = bookDetailPage.formatRow("EPUB");
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book with kindle sends failing", async () => {
        await bookDetailPage.stubKindleSend({
          status: "failed",
          message: "SMTP delivery failed",
        });
        await bookDetailPage.goto(uuid);
      });

      // The stub answers the send request, so this test does not assert it.
      await test.step("send it to kindle", async () => {
        await epubRow.sendToKindle();
        await expect(epubRow.kindleSendStatus).toHaveClass(/error/);
      });

      // An error toast stays up until dismissed, unlike the success toast.
      await test.step("dismiss the error", async () => {
        await epubRow.dismissKindleToast();
        await expect(epubRow.kindleSendStatus).toHaveCount(0);
      });
    });
  });

  test.describe("from the same hand", () => {
    test("show the author's other books", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the row shows", async () => {
        await expect(bookDetailPage.fromSameHandRow).toBeVisible();
        await expect(bookDetailPage.fromSameHandEmptyMessage).toHaveCount(0);
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
      const uuid = await fetchBookUuidByTitle(request, SOLO.title);

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
    test("state no count until the author fetch lands", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      const release = await test.step("hold the author fetch", async () => {
        return bookDetailPage.holdAuthorFetch();
      });

      await test.step("open the book", async () => {
        await bookDetailPage.gotoWhileLoading(uuid);
      });

      await test.step("check the section says it is still looking", async () => {
        await expect(bookDetailPage.fromSameHandLoadingMessage).toBeVisible();
        await expect(bookDetailPage.fromSameHandEmptyMessage).toHaveCount(0);
        await expect(bookDetailPage.onlyBookByNote).toHaveCount(0);
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

  test.describe("rating", () => {
    // Writing tests park the book first, since a rating outlives a test.
    test("hide other ratings when nobody else rated the book", async ({
      bookDetailPage,
      request,
    }) => {
      const { rating } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book with no other ratings", async () => {
        await rating.stubOtherRatings([]);
        await bookDetailPage.goto(uuid);
      });

      await test.step("check no other ratings show", async () => {
        await expect(rating.otherRatingsList).toHaveCount(0);
      });
    });

    test("show another reader's rating with its byline", async ({
      bookDetailPage,
      request,
    }) => {
      const { rating } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86_400;
      const other: AttributedRating = {
        user_id: 42,
        username: "reader",
        has_avatar: false,
        stars: 4.5,
        updated_at: twoDaysAgo,
      };

      await test.step("open the book with another reader's rating", async () => {
        await rating.stubOtherRatings([other]);
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the rating shows", async () => {
        await expect(rating.otherRatingRow).toBeVisible();
        await expect(rating.otherRatingRow).toContainText("R");
        await expect(rating.otherRatingByline).toHaveText(
          "reader rated 2 days ago",
        );
        await expect(rating.otherRatingContent).toHaveCSS(
          "flex-direction",
          "column",
        );
        await expect(
          rating.otherRatingStars("4.5 out of 5 stars"),
        ).toBeVisible();
      });
    });

    test("rate a book a half star", async ({
      bookDetailPage,
      request,
      presetRating,
      expectMutation,
    }) => {
      const { rating } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      await test.step("clear the rating through the api", async () => {
        await presetRating(uuid, null);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(rating.starsGroup).toBeVisible();
        await expect(rating.metaText).toHaveText("Not rated yet");
      });

      await test.step("rate it 4.5 stars", async () => {
        await expectMutation(ratings.set(uuid, 4.5), () => rating.rate(4.5));
      });

      await test.step("check the rating shows", async () => {
        await expect(rating.metaText).toContainText("4.5 of 5");
      });
    });

    // #2352: the rated half star announces that it un-rates, not "Rate 4.5".
    test("show the saved rating when the book opens", async ({
      bookDetailPage,
      request,
      presetRating,
    }) => {
      const { rating } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      await test.step("rate the book 4.5 stars through the api", async () => {
        await presetRating(uuid, 4.5);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the rating shows", async () => {
        await expect(rating.metaText).toContainText("4.5 of 5");
        await expect(rating.clearButton(4.5)).toBeVisible();
      });
    });

    test("clear a rating", async ({
      bookDetailPage,
      request,
      presetRating,
      expectMutation,
    }) => {
      const { rating } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      await test.step("rate the book 4.5 stars through the api", async () => {
        await presetRating(uuid, 4.5);
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("clear the rating", async () => {
        await expectMutation(ratings.clear(uuid), () => rating.clear(4.5));
      });

      await test.step("check the book shows unrated", async () => {
        await expect(rating.metaText).toHaveText("Not rated yet");
      });
    });

    test("show an error when a rating fails to save", async ({
      bookDetailPage,
      request,
      presetRating,
      expectMutation,
    }) => {
      const { rating } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);

      await test.step("clear the rating through the api", async () => {
        await presetRating(uuid, null);
      });

      await test.step("open the book while saves fail", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.forceServerError(ratings.set(uuid, 3));
      });

      await test.step("rate it 3 stars", async () => {
        await expectMutation(failing(ratings.set(uuid, 3)), () =>
          rating.rate(3),
        );
      });

      // The optimistic pick rolls back and the status line reports the failure.
      await test.step("check the rating reports the failure", async () => {
        await expect(rating.metaText).toHaveText(
          "Couldn't save rating — try again",
        );
      });
    });
  });
});

test("renders the read-status control with three segments", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
  await gotoReady(page, `/books/${uuid}`);

  const control = page.getByTestId("read-status-control");
  await expect(control).toBeVisible();
  await expect(control.getByTestId("read-status-unread")).toBeVisible();
  await expect(control.getByTestId("read-status-reading")).toBeVisible();
  await expect(control.getByTestId("read-status-finished")).toBeVisible();
});

test("marks a book finished, persists across reload, then resets to unread", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
  await gotoReady(page, `/books/${uuid}`);

  const control = page.getByTestId("read-status-control");
  // Mark finished → POST set, the Finished segment activates, meta updates.
  await expectMutation(
    page,
    { method: "POST", url: "/api/rpc/read-status/set", expectedStatus: 200 },
    async () => control.getByTestId("read-status-finished").click(),
  );
  await expect(control.getByTestId("read-status-finished")).toHaveClass(
    /active/,
  );
  await expect(page.getByTestId("read-status-meta")).toContainText("Finished");

  // The saved state survives a reload (the post-mount effect refetches it).
  await gotoReady(page, `/books/${uuid}`);
  await expect(
    page.getByTestId("read-status-control").getByTestId("read-status-finished"),
  ).toHaveClass(/active/);

  // Reset to unread so the shared server state is clean for the next run.
  await expectMutation(
    page,
    { method: "POST", url: "/api/rpc/read-status/set", expectedStatus: 200 },
    async () =>
      page
        .getByTestId("read-status-control")
        .getByTestId("read-status-unread")
        .click(),
  );
  await expect(page.getByTestId("read-status-meta")).toHaveText("Not started");
});

test("reverts the read status and reports an error when the save fails", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
  await gotoReady(page, `/books/${uuid}`);

  // Establish a known baseline (reading), then force the next save to fail.
  const control = page.getByTestId("read-status-control");
  await expectMutation(
    page,
    { method: "POST", url: "/api/rpc/read-status/set", expectedStatus: 200 },
    async () => control.getByTestId("read-status-reading").click(),
  );
  await expect(control.getByTestId("read-status-reading")).toHaveClass(
    /active/,
  );

  await page.route("**/api/rpc/read-status/set", (route) =>
    route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "read-status exploded",
    }),
  );
  await expectMutation(
    page,
    { method: "POST", url: "/api/rpc/read-status/set", expectedStatus: 500 },
    async () => control.getByTestId("read-status-finished").click(),
  );

  // The optimistic pick rolls back to reading and the status line reports it.
  await expect(control.getByTestId("read-status-reading")).toHaveClass(
    /active/,
  );
  await expect(page.getByTestId("read-status-meta")).toHaveText(
    "Couldn't save — try again",
  );

  // Clean up shared state: drop the route override and reset to unread.
  await page.unroute("**/api/rpc/read-status/set");
  await expectMutation(
    page,
    { method: "POST", url: "/api/rpc/read-status/set", expectedStatus: 200 },
    async () => control.getByTestId("read-status-unread").click(),
  );
});

// ---------------------------------------------------------------------------
// Action — saved passages (highlights)
// ---------------------------------------------------------------------------

/// Seed one highlight on PASSAGES_BOOK and return its uuid, id and quote. The
/// quote is stamped so a re-run never collides with a leftover row on the
/// shared, persistent dev DB. `note` needs a follow-up PATCH — `CreateHighlight`
/// carries no note field, so passing one to the POST would be silently dropped.
async function seedPassage(
  request: APIRequestContext,
  cfi: string,
  note?: string,
): Promise<{ uuid: string; id: number; quote: string }> {
  const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
  const quote = `saved passage ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post("/api/highlights", {
    data: {
      book_uuid: uuid,
      epub_cfi_range: cfi,
      color: "violet",
      text: quote,
    },
  });
  expect(created.status(), "seed highlight").toBe(200);
  const { id } = (await created.json()) as { id: number };
  if (note !== undefined) {
    const patched = await request.patch(`/api/highlights/${id}/note`, {
      data: { note },
    });
    expect(patched.status(), "seed highlight note").toBe(204);
  }
  return { uuid, id, quote };
}

/// Delete every highlight on `uuid`.
async function clearPassages(request: APIRequestContext, uuid: string) {
  const list = await request.get(`/api/highlights/book/${uuid}`);
  expect(list.status(), "list highlights").toBe(200);
  for (const h of (await list.json()) as { id: number }[]) {
    expect((await request.delete(`/api/highlights/${h.id}`)).status()).toBe(
      204,
    );
  }
}

// Start from a known-empty book. These tests assert the empty state *returns*
// after a delete, so residue from an interrupted earlier run would fail them
// for the wrong reason.
test.beforeAll(async ({ request }) => {
  await clearPassages(
    request,
    await fetchBookUuidByTitle(request, PASSAGES_BOOK.title),
  );
});

test("lists a saved passage with its locator, note and date, then deletes it", async ({
  page,
  request,
}) => {
  const { uuid, quote } = await seedPassage(
    request,
    "epubcfi(/6/14[chap03]!/4/2,/1:0,/1:40)",
    "the line that stuck",
  );

  await gotoReady(page, `/books/${uuid}`);

  // The empty state must give way to the list.
  await expect(page.getByTestId("highlights-empty")).toHaveCount(0);
  const card = page.getByTestId("highlight-card").filter({ hasText: quote });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("highlight-note")).toHaveText(
    "the line that stuck",
  );
  // The locator names the chapter's own TOC title once the book's structure
  // is known (#2463), and falls back to the CFI's raw spine step
  // (/14 → section 7) until then (#2356) — either is a valid locator for the
  // same position, so assert the shape rather than one of the two. The date
  // comes from the server-assigned created_at.
  await expect(card.getByTestId("highlight-meta")).toContainText(
    /^.+ · saved /,
  );
  await expect(card.getByTestId("highlight-meta")).toContainText("saved ");

  // Delete it — the RPC must fire and the card must leave the list.
  await expectMutation(
    page,
    {
      method: "POST",
      url: /\/api\/rpc\/highlights\/delete(?:\?|$)/,
      expectedStatus: 200,
    },
    async () => card.getByTestId("highlight-delete").click(),
  );
  await expect(page.getByText(quote)).toHaveCount(0);
  await expect(page.getByTestId("highlights-empty")).toBeVisible();
});

test("keeps the passage listed when the delete request fails", async ({
  page,
  request,
}) => {
  const { uuid, quote } = await seedPassage(
    request,
    "epubcfi(/6/6!/4/2,/1:0,/1:20)",
  );

  await gotoReady(page, `/books/${uuid}`);
  const card = page.getByTestId("highlight-card").filter({ hasText: quote });
  await expect(card).toHaveCount(1);

  await page.route("**/api/rpc/highlights/delete*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "delete exploded",
    }),
  );
  await expectMutation(
    page,
    {
      method: "POST",
      url: /\/api\/rpc\/highlights\/delete(?:\?|$)/,
      expectedStatus: 500,
    },
    async () => card.getByTestId("highlight-delete").click(),
  );

  // The row is only dropped once the server confirms, so it survives.
  await expect(card).toHaveCount(1);

  // Clean up shared state: drop the override and delete for real.
  await page.unroute("**/api/rpc/highlights/delete*");
  await expectMutation(
    page,
    {
      method: "POST",
      url: /\/api\/rpc\/highlights\/delete(?:\?|$)/,
      expectedStatus: 200,
    },
    async () => card.getByTestId("highlight-delete").click(),
  );
  await expect(page.getByText(quote)).toHaveCount(0);
});

test("opens the reader at the passage via a cfi deep link", async ({
  page,
  request,
}) => {
  const cfi = "epubcfi(/6/4!/4/2,/1:0,/1:30)";
  const { uuid, id, quote } = await seedPassage(request, cfi);

  await gotoReady(page, `/books/${uuid}`);
  const card = page.getByTestId("highlight-card").filter({ hasText: quote });
  const open = card.getByTestId("highlight-open");

  // The link carries the percent-encoded CFI so the reader boots at the
  // passage rather than resuming wherever this book was last left off.
  // Assert the decoded contract, not the escaping style — the Rust encoder
  // escapes `!()` too, which `encodeURIComponent` leaves alone.
  const href = await open.getAttribute("href");
  expect(href).not.toBeNull();
  const linked = new URL(href as string, page.url());
  expect(linked.pathname).toBe(`/read/${uuid}`);
  expect(linked.searchParams.get("cfi")).toBe(cfi);

  await open.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/read/${uuid}` && url.searchParams.get("cfi") === cfi,
  );
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // Clean up the seeded highlight so re-runs start from the empty state.
  expect((await request.delete(`/api/highlights/${id}`)).status()).toBe(204);
});

test("opens the quote-card editor in a modal and closes it again", async ({
  page,
  request,
}) => {
  const { uuid, id, quote } = await seedPassage(
    request,
    "epubcfi(/6/10!/4/2,/1:0,/1:25)",
  );

  await gotoReady(page, `/books/${uuid}`);
  const card = page.getByTestId("highlight-card").filter({ hasText: quote });
  await card.getByTestId("highlight-quote").click();

  // The shared quote-card editor mounts in the app modal shell with the
  // passage on the preview and the export actions available.
  const modal = page.getByTestId("quote-card-modal");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("heading", { name: "Make a quote card" }),
  ).toBeVisible();
  await expect(modal).toContainText(quote);
  await expect(modal.getByTestId("quote-download")).toBeVisible();
  await expect(modal.getByTestId("quote-copy-image")).toBeVisible();

  // Typography controls restyle the preview in place — no request fires, so
  // assert the rendered card rather than a network contract.
  const preview = modal.getByTestId("quote-preview");
  const previewBody = modal.getByTestId("quote-preview-body");
  await expect(preview).toHaveCSS("font-family", /Cormorant Garamond/);
  await modal.getByRole("button", { name: "Sans", exact: true }).click();
  await expect(preview).toHaveCSS("font-family", /Instrument Sans/);

  await expect(previewBody).toHaveCSS("font-style", "italic");
  await modal.getByRole("button", { name: "Italic", exact: true }).click();
  await expect(previewBody).toHaveCSS("font-style", "normal");
  await modal.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(previewBody).toHaveCSS("font-weight", "700");
  await modal.getByRole("button", { name: "L", exact: true }).click();
  await expect(previewBody).toHaveCSS("font-size", "27px");

  // Close via the X — no mutation fires; the card stays listed.
  await modal.getByRole("button", { name: "Close" }).click();
  await expect(modal).toHaveCount(0);
  await expect(card).toHaveCount(1);

  // Clean up the seeded highlight so re-runs start from the empty state.
  expect((await request.delete(`/api/highlights/${id}`)).status()).toBe(204);
});

test("lists every saved passage with no show-more control", async ({
  page,
  request,
}) => {
  // Earlier tests in this serial file leave passages behind on PASSAGES_BOOK,
  // so clear it first — the visible count is the whole assertion here.
  const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
  await clearPassages(request, uuid);
  const ids: number[] = [];
  for (let i = 0; i < 8; i++) {
    ids.push((await seedPassage(request, `epubcfi(/6/${4 + i * 2}!/4/2)`)).id);
  }

  await gotoReady(page, `/books/${uuid}`);
  // The stop scrolls the list rather than holding rows back, so all eight
  // are in the DOM and nothing offers to load more.
  await expect(page.getByTestId("highlight-card")).toHaveCount(8);
  await expect(page.getByTestId("highlights-show-more")).toHaveCount(0);

  // Clean up shared state so the next run starts from the empty state.
  for (const id of ids) {
    expect((await request.delete(`/api/highlights/${id}`)).status()).toBe(204);
  }
});

// ---------------------------------------------------------------------------
// Audiobook-only seed: re-seeds the server with the audiobook fixtures so
// the audio-only "Start listening" CTA can be exercised. Sharded into a
// `describe` block so the audiobook re-seed only runs for the listen-CTA
// test — the rest of the spec keeps the ebook library it set up above.
// ---------------------------------------------------------------------------

test.describe("audiobook-only seed", () => {
  test.beforeAll(async ({ request }) => {
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      AUDIOBOOK_BOOK_COUNT,
    );
  });

  // The merge-only MP3 pair. Merging them (F5.10 allows same-format merges)
  // is what produces a real multi-file `book_files` group for #1005's
  // file-picker coverage below. They are reserved for the merge tests
  // precisely so this mutation stays invisible to the specs running in
  // parallel against the same server — see `fixtures/audiobooks.ts`.
  const PRIMARY_MP3 = MERGE_PRIMARY;
  const SECOND_MP3 = MERGE_SECONDARY;

  // Read-only audiobook for the non-mutating CTA test below. It must NOT be
  // one of the merge pair: that test asserts the *absence* of a file picker,
  // which a concurrent merge would falsify.
  const SOLO_MP3 = AUDIOBOOK_BOOKS.find(
    (b) =>
      b.format === "MP3" &&
      b.source === "generated" &&
      !MERGE_ONLY_TITLES.includes(b.title),
  )!;

  test("Start listening navigates to /listen/:uuid for audio-only books", async ({
    page,
    request,
  }) => {
    // Pick an MP3 audiobook with no ebook companion — has_audio is true
    // and has_ebook is false, so the hero renders "Start listening" as
    // the primary CTA (the secondary "Listen" button only appears when
    // both formats coexist).
    const uuid = await fetchBookUuidByTitle(request, SOLO_MP3.title);
    await gotoReady(page, `/books/${uuid}`);

    const startListening = page.getByTestId("start-listening");
    await expect(startListening).toBeVisible();
    await expect(startListening).toHaveAttribute(
      "href",
      new RegExp(`/listen/${uuid}$`),
    );

    // AC2 (#1005): a single-file audiobook shows no file picker next to
    // the CTA — the picker only appears once a book has >1 file of the
    // format that CTA opens (see the merge-based test below).
    await expect(page.getByTestId("listen-file-picker-trigger")).toHaveCount(0);

    // Clicking the primary CTA must SPA-navigate to the listen page — with
    // no trailing `?`, per #2256.
    await startListening.click();
    await expect(page).toHaveURL(new RegExp(`/listen/${uuid}$`));
  });

  // ---------------------------------------------------------------------------
  // #1005 — Listen file picker for a multi-file (duplicate-format) audiobook
  // ---------------------------------------------------------------------------

  test("shows a Listen file picker after merging two same-format audiobooks, and picking a file navigates with its file_id", async ({
    page,
    request,
  }) => {
    // Serialize against merge.spec's audiobook merge: both mutate "The
    // Analytical Audiobook" on the shared per-shard server, so running them in
    // parallel workers corrupts this test's two-file state. The lock leaves the
    // fixture restored (via the finally undo) before releasing. `test.slow()`
    // covers the worst case of waiting out the other holder plus this run.
    test.slow();
    await withLock("audiobook-merge", async () => {
      const primaryUuid = await fetchBookUuidByTitle(
        request,
        PRIMARY_MP3.title,
      );
      const secondUuid = await fetchBookUuidByTitle(request, SECOND_MP3.title);

      // Arrange: merge SECOND into PRIMARY via the RPC directly (the merge
      // dialog UI itself is covered by merge.spec.ts) so PRIMARY ends up with
      // two MP3 `book_files` rows — the duplicate-format scenario #1005's
      // picker targets. `merge_log_id` is the undo handle used in `finally`.
      const mergeResp = await request.post("/api/rpc/merge-books", {
        data: { source_uuid: secondUuid, target_uuid: primaryUuid },
      });
      expect(mergeResp.status(), "POST /api/rpc/merge-books failed").toBe(200);
      const { merge_log_id: mergeLogId } = (await mergeResp.json()) as {
        merge_log_id: number;
      };

      try {
        await gotoReady(page, `/books/${primaryUuid}`);

        // AC1: a book with >1 file of the format the CTA opens shows a way
        // to pick which file to open before listening.
        const trigger = page.getByTestId("listen-file-picker-trigger");
        await expect(trigger).toBeVisible();
        await expect(trigger).toHaveText(/Start listening\s*▾/);
        await expect(page.getByTestId("listen-file-picker-panel")).toHaveCount(
          0,
        );
        await trigger.click();
        const panel = page.getByTestId("listen-file-picker-panel");
        await expect(panel).toBeVisible();
        await expect(page.getByTestId("listen-file-picker-heading")).toHaveText(
          "2 files · choose one",
        );
        await expect(panel.getByRole("link")).toHaveCount(2);
        await expect(panel.getByRole("link").first()).toContainText(
          "Audiobook ·",
        );
        await expect(panel.getByRole("link").first()).toContainText(
          /\d+(?:\.\d+)? [KMGT]?B/,
        );

        // Picking the second (non-default) file navigates to /listen/:uuid
        // with that file's id, and the manifest fetch carries the same id.
        const [manifestReq] = await Promise.all([
          page.waitForRequest((req) =>
            req
              .url()
              .includes(`/api/audiobooks/${primaryUuid}/manifest?file_id=`),
          ),
          panel.getByRole("link").nth(1).click(),
        ]);
        expect(manifestReq.url()).toMatch(
          new RegExp(`/api/audiobooks/${primaryUuid}/manifest\\?file_id=\\d+$`),
        );
        await expect(page).toHaveURL(
          new RegExp(`/listen/${primaryUuid}\\?file_id=\\d+$`),
        );
      } finally {
        // Undo — restores SECOND as its own book so later specs (and re-runs
        // of this one) see the pre-merge fixture state, mirroring
        // merge.spec.ts's own undo-as-cleanup pattern.
        const undoResp = await request.post("/api/rpc/merge-books/undo", {
          data: { merge_log_id: mergeLogId },
        });
        expect(undoResp.status(), "POST /api/rpc/merge-books/undo failed").toBe(
          200,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Regression: picking a different part of the *already-playing* book must
  // switch parts. The app-root web driver used to react only to the book uuid
  // (constant across a book's files), so re-picking a file on the active book
  // silently kept part 1. Assert a fresh manifest fetch fires for the newly
  // selected file_id even when the uuid is unchanged.
  // ---------------------------------------------------------------------------

  test("re-picking a different part of the already-active audiobook reloads onto that part", async ({
    page,
    request,
  }) => {
    test.slow();
    await withLock("audiobook-merge", async () => {
      const primaryUuid = await fetchBookUuidByTitle(
        request,
        PRIMARY_MP3.title,
      );
      const secondUuid = await fetchBookUuidByTitle(request, SECOND_MP3.title);

      const mergeResp = await request.post("/api/rpc/merge-books", {
        data: { source_uuid: secondUuid, target_uuid: primaryUuid },
      });
      expect(mergeResp.status(), "POST /api/rpc/merge-books failed").toBe(200);
      const { merge_log_id: mergeLogId } = (await mergeResp.json()) as {
        merge_log_id: number;
      };

      try {
        // The two audio `book_files` rows the merge produced, in file-picker
        // order (`GET /api/ebooks/:uuid` returns them by ordinal).
        const detailResp = await request.get(`/api/ebooks/${primaryUuid}`);
        expect(detailResp.status(), "GET /api/ebooks/:uuid failed").toBe(200);
        const detail = (await detailResp.json()) as {
          book_files: { id: number; format: string }[];
        };
        const audioIds = detail.book_files
          .filter((f) => /^(mp3|m4b|m4a)$/i.test(f.format))
          .map((f) => f.id);
        expect(audioIds.length, "expected two audio files after merge").toBe(2);

        // The whole flow below is one single-page-app session: a single full
        // load of the book-detail page, then every navigation is a real Dioxus
        // `<Link>` (the file picker) or an in-app history transition
        // (`goBack`). The `__repickSentinel` on `window` is set once after that
        // initial load and must survive to the end — a full page load anywhere
        // clears it, and a full reload refetches the manifest regardless of the
        // app-root driver fix, so the sentinel is what proves the *driver* (not
        // a reload) rebooted onto the newly-picked part.
        //
        // (A raw injected `<a>` is NOT usable here: dioxus-web routes clicks
        // through its `Link` components, not a document-level delegated
        // listener, so an injected anchor full-page-loads and defeats the
        // sentinel. The real picker links are the only faithful in-app nav.)
        const manifestFor = (fid: string) =>
          new RegExp(
            `/api/audiobooks/${primaryUuid}/manifest\\?file_id=${fid}$`,
          );
        const pickerLinks = async () => {
          await page.getByTestId("listen-file-picker-trigger").click();
          await expect(
            page.getByTestId("listen-file-picker-panel"),
          ).toBeVisible();
          return page.getByTestId("listen-file-picker-panel").getByRole("link");
        };
        const fileIdOf = (manifestUrl: string) =>
          new URL(manifestUrl).searchParams.get("file_id");

        await gotoReady(page, `/books/${primaryUuid}`);
        await page.evaluate(() => {
          (
            window as unknown as { __repickSentinel?: boolean }
          ).__repickSentinel = true;
        });

        // Pick the FIRST part via the picker → SPA-navigate to /listen and make
        // the book the active playback book (uuid now set on the app-root
        // PlaybackState).
        const [firstManifest] = await Promise.all([
          page.waitForRequest((req) => manifestFor("\\d+").test(req.url())),
          (await pickerLinks()).nth(0).click(),
        ]);
        const firstFileId = fileIdOf(firstManifest.url());
        await expect(page).toHaveURL(
          new RegExp(`/listen/${primaryUuid}\\?file_id=\\d+$`),
        );

        // Back to the detail page in-app (history popstate — no full load).
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/books/${primaryUuid}$`));

        // Re-pick the SECOND part of the *already-active* book. Before the fix
        // the driver keyed only on the (unchanged) uuid, so this fired no fresh
        // manifest and stayed on part 1.
        const [secondManifest] = await Promise.all([
          page.waitForRequest((req) => manifestFor("\\d+").test(req.url()), {
            timeout: 10_000,
          }),
          (await pickerLinks()).nth(1).click(),
        ]);
        const secondFileId = fileIdOf(secondManifest.url());
        expect(
          secondFileId,
          "re-pick must reboot onto a different part",
        ).not.toBe(firstFileId);

        // The whole session stayed client-side — if any hop fully reloaded, the
        // manifest fetch above would prove nothing.
        const stayedInApp = await page.evaluate(
          () =>
            (window as unknown as { __repickSentinel?: boolean })
              .__repickSentinel === true,
        );
        expect(
          stayedInApp,
          "re-pick nav must stay in-app (no full page load)",
        ).toBe(true);
      } finally {
        const undoResp = await request.post("/api/rpc/merge-books/undo", {
          data: { merge_log_id: mergeLogId },
        });
        expect(undoResp.status(), "POST /api/rpc/merge-books/undo failed").toBe(
          200,
        );
      }
    });
  });
});
