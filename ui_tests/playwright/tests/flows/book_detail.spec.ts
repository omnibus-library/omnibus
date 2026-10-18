import { account } from "../contracts/account";
import { highlights } from "../contracts/highlights";
import { kindle } from "../contracts/kindle";
import { ratings } from "../contracts/ratings";
import { readStatus } from "../contracts/readStatus";
import type { OtherRating } from "../data/bookDetail";
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

// `alpha` is a single-author standalone ebook (Ada Lovelace), so the
// breadcrumb is Home > Ada Lovelace > Alpha.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// Niklaus Wirth leads four books (the Code Quartet), so visiting any one
// surfaces the other three under "From the same hand".
const WIRTH_LEAD = FIXTURE_BOOKS.find((b) => b.slug === "code-quartet-1")!;
const WIRTH_OTHERS = FIXTURE_BOOKS.filter(
  (b) => b.authors[0] === "Niklaus Wirth" && b.slug !== WIRTH_LEAD.slug,
);

// Read state is per-(user, book) server state, so this book is read by no
// other spec; `standalone-canyon` (Annie Easley) appears in no other flow.
const READ_STATUS_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-canyon",
)!;

// Highlights are per-(user, book) too; `standalone-garden` is read by no other
// flow, and the reader spec's own highlight books stay untouched.
const PASSAGES_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-garden",
)!;

test.describe("book detail page", () => {
  // The audiobook re-seed below re-points the shared library, so under
  // `fullyParallel` it must not interleave with the ebook-seeded tests.
  test.describe.configure({ mode: "serial" });

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
      // The breadcrumb repeats the name, so the authors line is the scope.
      await expect(bookDetailPage.authorsLine).toContainText(author);
      await expect(bookDetailPage.authorLink(author)).toBeVisible();
      await expect(bookDetailPage.heroCover).toBeVisible();
      // Alpha is EPUB-only, so the primary action is Start reading.
      await expect(bookDetailPage.startReadingButton).toBeVisible();
      await expect(bookDetailPage.startReadingButton).toHaveAttribute(
        "href",
        new RegExp(`/read/${uuid}$`),
      );
    });

    await test.step("check the dot rail lists the six stops", async () => {
      const { stops } = bookDetailPage;
      await expect(stops.dotRail).toBeVisible();
      await expect(stops.dotButtons).toHaveCount(6);
      await expect(stops.dot(0)).toHaveClass(/\bon\b/);
    });

    // The Scroll stops switch sits at the top of the stage, apart from the rail.
    await test.step("check the scroll stops switch sits above the rail", async () => {
      const { stops } = bookDetailPage;
      await expect(stops.modeToggle).toBeVisible();
      await expect(stops.modeToggleInRail).toHaveCount(0);
      expect(await stops.bottomEdge(stops.modeToggle)).toBeLessThan(
        await stops.topEdge(stops.dotRail),
      );
    });

    // Only presence: journal.spec saves a highlight on this book, so whether
    // the list or the empty state fills it depends on run order.
    await test.step("check the passages and more stops show", async () => {
      const { savedPassages, fromSameHand, stops } = bookDetailPage;
      await expect(savedPassages.heading).toBeVisible();
      await expect(savedPassages.section).toBeVisible();
      await expect(stops.moreStop).toBeAttached();
      await expect(fromSameHand.heading).toBeVisible();
    });
  });

  test.describe("scroll stops preference", () => {
    test("show one continuous flow with numbered section rules by default", async ({
      bookDetailPage,
      request,
      setScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { stops } = bookDetailPage;

      await test.step("open the book with the preference off", async () => {
        await setScrollStops(false);
        await bookDetailPage.goto(uuid);
      });

      // The flow owns the scrolling, so the snap container is not rendered.
      await test.step("check six sections flow without snapping", async () => {
        await expect(stops.flow).toBeAttached();
        await expect(stops.snap).toHaveCount(0);
        await expect(stops.flowSections).toHaveCount(6);
        await expect(stops.nextCues).toHaveCount(0);
      });

      // The first section is the book itself, headed by its own title.
      await test.step("check every section after the first has a rule", async () => {
        await expect(stops.leadFlowSection).toHaveCount(1);
        await expect(stops.leadFlowLabels).toHaveCount(0);
        await expect(stops.flowLabels).toHaveCount(5);
        await expect(stops.firstFlowLabel).toContainText("Stats");
      });

      await test.step("check the back to the book pill waits for a scroll", async () => {
        await expect(stops.flowTopPill).toBeAttached();
        await expect(stops.flowTopPill).not.toHaveClass(/\bon\b/);
        await stops.scrollFlowTo(900);
        await expect(stops.flowTopPill).toHaveClass(/\bon\b/);
      });

      // The cover drifts with the scroll instead of panning stop to stop.
      await test.step("check the cover tracks the scroll", async () => {
        expect(await stops.coverTransform()).toMatch(/translateY/);
      });

      await test.step("return to the book", async () => {
        await stops.returnToBook();
        await expect.poll(() => stops.flowScrollTop()).toBe(0);
        await expect(stops.flowTopPill).not.toHaveClass(/\bon\b/);
      });
    });

    test("flip the switch in settings to change the next detail page", async ({
      bookDetailPage,
      libraryPage,
      settingsPage,
      request,
      setScrollStops,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { stops } = bookDetailPage;

      // Arrive first, so the app-wide viewer already holds the old value, the
      // state the stale read came from.
      await test.step("open the book with the preference off", async () => {
        await setScrollStops(false);
        await bookDetailPage.goto(uuid);
        await expect(stops.flow).toBeAttached();
      });

      await test.step("flip the switch in settings", async () => {
        await settingsPage.goto("preferences");
        await expectMutation(account.scrollStops(), () =>
          settingsPage.account.toggleScrollStops(),
        );
      });

      await test.step("open the book again", async () => {
        await libraryPage.topNav.openLibrary();
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the snapped marquee shows", async () => {
        await expect(stops.snap).toBeAttached();
        await expect(stops.flow).toHaveCount(0);
      });
    });

    test("flip between the flow and the stops with the page's own switch", async ({
      bookDetailPage,
      request,
      setScrollStops,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { stops } = bookDetailPage;

      await test.step("open the book with the preference off", async () => {
        await setScrollStops(false);
        await bookDetailPage.goto(uuid);
        await expect(stops.modeToggle).toBeEnabled();
        await expect(stops.modeToggle).toHaveAttribute("aria-pressed", "false");
        await expect(stops.flow).toBeAttached();
      });

      // A flip keeps the reader in place, so read down to the journal first.
      await test.step("read down to the journal", async () => {
        await stops.scrollFlowToStop(3);
        await expect(stops.dot(3)).toHaveClass(/\bon\b/);
      });

      await test.step("flip to the stops", async () => {
        await expectMutation(account.scrollStops(true), () => stops.flipMode());
      });

      // No reload: the stage re-renders in the other reading on the same stop,
      // the switch keeps focus and the marquee's glue follows the swap.
      await test.step("check the snapped marquee shows on the same stop", async () => {
        await expect(stops.snap).toBeAttached();
        await expect(stops.flow).toHaveCount(0);
        await expect(stops.modeToggle).toHaveAttribute("aria-pressed", "true");
        await expect(stops.modeToggle).toBeFocused();
        await expect(stops.section(3)).toBeInViewport();
        await expect(stops.dot(3)).toHaveClass(/\bon\b/);
      });

      await test.step("check the rail tracks the snapped stops", async () => {
        await stops.scrollSnapToStop(4);
        await expect(stops.dot(4)).toHaveClass(/\bon\b/);
      });

      await test.step("flip back to the flow", async () => {
        await expectMutation(account.scrollStops(false), () =>
          stops.flipMode(),
        );
      });

      await test.step("check the switch is still live after the swap", async () => {
        await expect(stops.flow).toBeAttached();
        await expect(stops.snap).toHaveCount(0);
        await expect(stops.modeToggle).toHaveAttribute("aria-pressed", "false");
        await expect(stops.section(4)).toBeInViewport();
        await expect(stops.dot(4)).toHaveClass(/\bon\b/);
      });
    });

    test("keep the reading and say so when a flip is refused", async ({
      bookDetailPage,
      request,
      setScrollStops,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { stops } = bookDetailPage;

      await test.step("open the book with the preference off", async () => {
        await setScrollStops(false);
        await bookDetailPage.goto(uuid);
        await bookDetailPage.forceServerError(account.scrollStops(true));
      });

      await test.step("try to flip to the stops", async () => {
        await expectMutation(failing(account.scrollStops(true)), () =>
          stops.flipMode(),
        );
      });

      await test.step("check the flow stays and the error shows", async () => {
        await expect(stops.modeError).toBeVisible();
        await expect(stops.modeToggle).toHaveAttribute("aria-pressed", "false");
        await expect(stops.flow).toBeAttached();
        await expect(stops.snap).toHaveCount(0);
      });
    });

    test("install the marquee's scroll glue when the preference is on", async ({
      bookDetailPage,
      request,
      setScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { stops } = bookDetailPage;

      await test.step("open the book with the preference on", async () => {
        await setScrollStops(true);
        await bookDetailPage.goto(uuid);
        await expect(stops.snap).toBeAttached();
      });

      // The first paint is the flow and the marquee replaces it once the viewer
      // resolves; stale flow listeners would leave the rail dead.
      await test.step("scroll to the fourth stop", async () => {
        await stops.scrollSnapToStop(3);
      });

      await test.step("check the rail follows the scroll", async () => {
        await expect(stops.dot(3)).toHaveClass(/\bon\b/);
        await expect(stops.dot(0)).not.toHaveClass(/\bon\b/);
      });
    });

    test("restore the snap-stop marquee when the preference is on", async ({
      bookDetailPage,
      request,
      setScrollStops,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { stops } = bookDetailPage;

      await test.step("open the book with the preference on", async () => {
        await setScrollStops(true);
        await bookDetailPage.goto(uuid);
      });

      // The same six sections either way; only the mechanics differ.
      await test.step("check the snap container replaces the flow", async () => {
        await expect(stops.snap).toBeAttached();
        await expect(stops.flow).toHaveCount(0);
        await expect(stops.snapSections).toHaveCount(6);
        await expect(stops.flowTopPill).toHaveCount(0);
      });

      await test.step("check the dot rail is common to both", async () => {
        await expect(stops.dotButtons).toHaveCount(6);
      });
    });
  });

  test("jump between stops with the dot rail", async ({
    bookDetailPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { stops, formats } = bookDetailPage;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // The scroll is smooth, so the active marker is polled.
    await test.step("jump to the files stop", async () => {
      await stops.jumpTo(4);
      await expect(stops.dot(4)).toHaveClass(/\bon\b/);
      await expect(stops.dot(0)).not.toHaveClass(/\bon\b/);
    });

    await test.step("check the files are on screen", async () => {
      await expect(formats.root).toBeInViewport();
    });
  });

  // The rail floats over the panel's right edge, so a box any wider than its
  // six dots takes the clicks meant for whatever scrolls beside it.
  test("leave the journal's new entry button beside the dot rail clickable", async ({
    bookDetailPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { stops, journal } = bookDetailPage;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
      await expect(journal.newEntryButton).toBeVisible();
    });

    // Park the button level with the rail, where the reader's click went dead.
    await test.step("scroll the button level with the rail", async () => {
      await stops.levelWithDotRail(journal.newEntryButton);
    });

    // A real pointer at the button's rail-side end, because `click()` would
    // scroll and retry until it found a spot the rail doesn't cover.
    await test.step("click the end of the button nearest the rail", async () => {
      await journal.clickNewEntryRailEnd();
      await expect(journal.composer).toBeVisible();
    });

    // Nothing was typed, so closing writes nothing.
    await test.step("close the composer", async () => {
      await journal.closeEmptyComposer();
      await expect(journal.composer).toHaveCount(0);
    });
  });

  test("open the reader from start reading", async ({
    bookDetailPage,
    epubReaderPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("start reading", async () => {
      await bookDetailPage.startReading();
      await epubReaderPage.assertDisplayedFor(uuid);
    });
  });

  test.describe("from the same hand", () => {
    test("list the other books by the same author", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);
      const { fromSameHand } = bookDetailPage;

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // The page drops the book itself from its own row.
      await test.step("check the row holds the other books only", async () => {
        await expect(fromSameHand.row).toBeVisible();
        await expect(fromSameHand.emptyMessage).toHaveCount(0);
        await expect(fromSameHand.tiles).toHaveCount(WIRTH_OTHERS.length);
        await expect(fromSameHand.coverOf(WIRTH_LEAD.title)).toHaveCount(0);
      });

      await test.step("open a sibling's page", async () => {
        await fromSameHand.openFirstTile();
        await bookDetailPage.assertDisplayedByUuid();
        await expect
          .poll(() => bookDetailPage.path())
          .not.toBe(`/books/${uuid}`);
      });
    });

    // Hedy Lamarr authors one work across the whole fixture set and no
    // audiobook, so seeding audiobooks cannot flip her to a multi-book author.
    test("show the empty note for a single-book author", async ({
      bookDetailPage,
      request,
    }) => {
      const solo = FIXTURE_BOOKS.find((b) => b.slug === "gamma")!;
      const uuid = await fetchBookUuidByTitle(request, solo.title);
      const { fromSameHand } = bookDetailPage;

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the empty note replaces the row", async () => {
        await expect(fromSameHand.heading).toBeVisible();
        await expect(fromSameHand.emptyMessage).toBeVisible();
        await expect(fromSameHand.row).toHaveCount(0);
      });
    });

    // Regression for #2478: the block read "1 book in your library" while the
    // author fetch was in flight, then corrected itself.
    test("state no count until the author fetch has landed", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);
      const { fromSameHand } = bookDetailPage;

      const release =
        await test.step("hold the author fetch and open the book", async () => {
          const release = await fromSameHand.holdAuthorFetch();
          await bookDetailPage.gotoUnsettled(uuid);
          return release;
        });

      await test.step("check the block says it is still looking", async () => {
        await expect(fromSameHand.loadingNote).toBeVisible();
        await expect(fromSameHand.emptyMessage).toHaveCount(0);
        await expect(fromSameHand.onlyBookNote).toHaveCount(0);
      });

      await test.step("release the fetch", async () => {
        release();
      });

      await test.step("check the real row replaces the note", async () => {
        await expect(fromSameHand.row).toBeVisible();
        await expect(fromSameHand.loadingNote).toHaveCount(0);
      });
    });
  });

  test("open a book from the landing table and return to the library", async ({
    libraryPage,
    bookDetailPage,
  }) => {
    await test.step("open the landing table", async () => {
      await libraryPage.goto();
      await libraryPage.table.switchTo();
    });

    // #2350: the row is a plain <tr> because its editable cells are
    // interactive controls, so the cover cell's link is the way in.
    await test.step("open the book from its row", async () => {
      await expect(
        libraryPage.table.openLink(TARGET.slug, TARGET.title),
      ).toBeVisible();
      await libraryPage.table.openBook(TARGET.slug, TARGET.title);
      await bookDetailPage.assertDisplayedByUuid();
    });

    await test.step("check the library comes back as a table", async () => {
      await libraryPage.topNav.openLibrary();
      await libraryPage.assertDisplayed();
      await expect(libraryPage.table.root).toBeVisible();
    });
  });

  test("show the selected book's details", async ({
    bookDetailPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { formats, exportMenu, rating, suggestions } = bookDetailPage;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the title and author", async () => {
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await expect(bookDetailPage.authorsLine).toContainText(
        TARGET.authors[0]!,
      );
    });

    await test.step("check the epub row lists its actions", async () => {
      await expect(formats.root).toBeVisible();
      await expect(formats.epubRow).toBeVisible();
      await expect(formats.epubRow).toHaveAttribute("data-format", "EPUB");
      // The marquee draws the format as a glyph tile, so the code lives in the
      // badge's accessible name.
      await expect(formats.epubBadge).toHaveAttribute("aria-label", "EPUB");
      await expect(bookDetailPage.readButton).toBeVisible();
      await expect(bookDetailPage.readButton).toHaveAttribute(
        "href",
        /\/read\//,
      );
      await expect(formats.kindleButton).toBeVisible();
      await expect(formats.kindleButton).toBeEnabled();
    });

    await test.step("open the export menu", async () => {
      await expect(exportMenu.trigger).toBeVisible();
      await expect(exportMenu.panel).toHaveCount(0);
      await exportMenu.open();
      await expect(exportMenu.panel).toBeVisible();
    });

    await test.step("check the export menu lists the ebook actions", async () => {
      await expect(exportMenu.downloadEpubLink).toHaveAttribute(
        "href",
        /\/api\/ebooks\/.+\/download$/,
      );
      await expect(exportMenu.downloadEpubLink).toHaveAttribute("download");
      await expect(exportMenu.sendToKindleButton).toBeVisible();
      await expect(exportMenu.sendToKindleButton).toBeEnabled();
      await expect(exportMenu.sendToKoboButton).toBeVisible();
      await expect(exportMenu.sendToKoboButton).toBeEnabled();
      // An ebook-only book has no audio file to download.
      await expect(exportMenu.downloadAudioLink).toHaveCount(0);
    });

    await test.step("close the export menu", async () => {
      await exportMenu.closeByClickingScrim();
      await expect(exportMenu.panel).toHaveCount(0);
    });

    // The hero's Listen button only renders when both formats are present.
    await test.step("check the epub row offers no listen action", async () => {
      await expect(formats.listenAction).toHaveCount(0);
    });

    // The suggestions' inner state depends on a Hardcover key and a live API,
    // so only the strip and its heading are asserted here.
    await test.step("check the rating and suggestions show", async () => {
      await expect(rating.stars).toBeVisible();
      await expect(suggestions.root).toBeAttached();
      await expect(suggestions.heading).toBeVisible();
    });

    await test.step("return to the library", async () => {
      await libraryPage.topNav.openLibrary();
      await libraryPage.assertDisplayed();
      await expect(libraryPage.grid).toBeVisible();
    });
  });

  test.describe("send to a device", () => {
    test("download the book for a kobo with a uuid-named file", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { formats } = bookDetailPage;

      await test.step("open the book without a directory picker", async () => {
        await formats.stubNoDirectoryPicker();
        await bookDetailPage.goto(uuid);
      });

      const downloads = formats.recordDownloads();

      await test.step("check the kobo action is offered", async () => {
        await expect(formats.koboButton).toBeVisible();
        await expect(formats.koboButton).toBeEnabled();
      });

      // The stem is the canonical uuid, which F4.4's USB import relies on; the
      // extension is `.kepub.epub` when kepubify converts and `.epub` otherwise.
      await test.step("send to the kobo", async () => {
        await formats.downloadForKobo();
        await expect
          .poll(() => downloads[0], { timeout: 30_000 })
          .toMatch(new RegExp(`^${uuid}\\.(kepub\\.)?epub$`));
      });
    });

    // Sending is enqueue-and-poll, so both calls are stubbed and no SMTP relay
    // or configured Kindle email is touched.
    test("send the epub to a kindle and show a sent status", async ({
      bookDetailPage,
      request,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { formats } = bookDetailPage;

      await test.step("open the book with deliveries stubbed", async () => {
        await formats.stubKindleDelivered();
        await bookDetailPage.goto(uuid);
        await expect(formats.kindleButton).toBeEnabled();
      });

      await test.step("send to the kindle", async () => {
        await expectMutation(kindle.send(uuid), () => formats.sendToKindle());
      });

      await test.step("check the sent status shows", async () => {
        await expect(formats.kindleStatus).toHaveText("Sent to your Kindle.");
        await expect(formats.kindleStatus).toHaveClass(/success/);
      });
    });

    // The queue succeeds and the worker's delivery then fails, which the status
    // poll reports; it once left the button on "Sending…" forever.
    test("show an error when the kindle send fails", async ({
      bookDetailPage,
      request,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { formats } = bookDetailPage;

      await test.step("open the book with deliveries failing", async () => {
        await formats.stubKindleDeliveryFailed("SMTP delivery failed");
        await bookDetailPage.goto(uuid);
      });

      await test.step("send to the kindle", async () => {
        await expectMutation(kindle.send(uuid), () => formats.sendToKindle());
      });

      // The error toast persists, unlike the success one, until dismissed.
      await test.step("check the error status shows", async () => {
        await expect(formats.kindleStatus).toHaveClass(/error/);
        await expect(formats.kindleStatus).toContainText(
          "SMTP delivery failed",
        );
      });

      await test.step("dismiss the error status", async () => {
        await formats.dismissKindleStatus();
        await expect(formats.kindleStatus).toHaveCount(0);
      });
    });
  });

  test.describe("ratings", () => {
    test("hide other ratings when no one else has rated the book", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { rating } = bookDetailPage;

      await test.step("open the book with no other ratings", async () => {
        await rating.stubOthers([]);
        await bookDetailPage.goto(uuid);
      });

      await test.step("check no other ratings show", async () => {
        await expect(rating.otherRatings).toHaveCount(0);
      });
    });

    test("show attributed ratings from other users", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const { rating } = bookDetailPage;
      const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86_400;
      const other: OtherRating = {
        user_id: 42,
        username: "reader",
        stars: 4.5,
        updated_at: twoDaysAgo,
      };

      await test.step("open the book with another reader's rating", async () => {
        await rating.stubOthers([other]);
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the rating is attributed to them", async () => {
        await expect(rating.otherRatingRow).toBeVisible();
        await expect(rating.otherRatingRow).toContainText("R");
        await expect(rating.otherRatingByline).toHaveText(
          "reader rated 2 days ago",
        );
        await expect(rating.otherRatingContent).toHaveCSS(
          "flex-direction",
          "column",
        );
        await expect(rating.otherRatingStars(4.5)).toBeVisible();
      });
    });

    // A Wirth book keeps the rating clear of the alpha assertions elsewhere in
    // this serial file.
    test("rate a book a half star", async ({
      bookDetailPage,
      request,
      expectMutation,
      ratedBookUuids,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);
      const { rating } = bookDetailPage;

      await test.step("open the unrated book", async () => {
        ratedBookUuids.add(uuid);
        await bookDetailPage.goto(uuid);
        await expect(rating.stars).toBeVisible();
        await expect(rating.meta).toHaveText("Not rated yet");
      });

      // The left half of the fifth star is 4.5.
      await test.step("rate it 4.5 stars", async () => {
        await expectMutation(ratings.set(), () => rating.rate(4.5));
        await expect(rating.meta).toContainText("4.5 of 5");
      });

      // The post-mount effect refetches the saved rating.
      await test.step("check the rating survives a reload", async () => {
        await bookDetailPage.goto(uuid);
        await expect(rating.meta).toContainText("4.5 of 5");
      });
    });

    test("clear a rating", async ({
      bookDetailPage,
      bookRatingRequests,
      request,
      expectMutation,
      ratedBookUuids,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);
      const { rating } = bookDetailPage;

      await test.step("rate the book through the api", async () => {
        ratedBookUuids.add(uuid);
        await expect(await bookRatingRequests.postRating(uuid, 4.5)).toBeOK();
      });

      await test.step("open the rated book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // #2352: the lit half star announces the un-rate control instead of the
      // misleading "Rate 4.5 stars".
      await test.step("clear the rating", async () => {
        await expect(rating.clearButton(4.5)).toBeVisible();
        await expectMutation(ratings.clear(), () => rating.clear(4.5));
        await expect(rating.meta).toHaveText("Not rated yet");
      });
    });

    test("keep the rating unchanged when the save fails", async ({
      bookDetailPage,
      request,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, WIRTH_LEAD.title);
      const { rating } = bookDetailPage;

      await test.step("open the book with rating saves failing", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.forceServerError(ratings.set());
      });

      await test.step("rate it 3 stars", async () => {
        await expectMutation(failing(ratings.set()), () => rating.rate(3));
      });

      // The optimistic pick rolls back and the status line reports the failure.
      await test.step("check the failure shows", async () => {
        await expect(rating.meta).toHaveText(
          "Couldn't save rating — try again",
        );
      });
    });
  });

  test.describe("read status", () => {
    test("show the read status control", async ({
      bookDetailPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
      const { readStatusControl } = bookDetailPage;

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("check the three segments show", async () => {
        await expect(readStatusControl.root).toBeVisible();
        await expect(readStatusControl.unreadSegment).toBeVisible();
        await expect(readStatusControl.readingSegment).toBeVisible();
        await expect(readStatusControl.finishedSegment).toBeVisible();
      });
    });

    test("mark a book finished", async ({
      bookDetailPage,
      request,
      expectMutation,
      presetReadStatus,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
      const { readStatusControl } = bookDetailPage;

      await test.step("open the unread book", async () => {
        await presetReadStatus(uuid, "unread");
        await bookDetailPage.goto(uuid);
      });

      await test.step("mark it finished", async () => {
        await expectMutation(readStatus.set(), () =>
          readStatusControl.markFinished(),
        );
        await expect(readStatusControl.finishedSegment).toHaveClass(/active/);
        await expect(readStatusControl.meta).toContainText("Finished");
      });

      // The post-mount effect refetches the saved state.
      await test.step("check the status survives a reload", async () => {
        await bookDetailPage.goto(uuid);
        await expect(readStatusControl.finishedSegment).toHaveClass(/active/);
      });
    });

    test("reset a finished book to unread", async ({
      bookDetailPage,
      request,
      expectMutation,
      presetReadStatus,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
      const { readStatusControl } = bookDetailPage;

      await test.step("open the finished book", async () => {
        await presetReadStatus(uuid, "finished");
        await bookDetailPage.goto(uuid);
      });

      await test.step("mark it unread", async () => {
        await expectMutation(readStatus.set(), () =>
          readStatusControl.markUnread(),
        );
        await expect(readStatusControl.meta).toHaveText("Not started");
      });
    });

    test("revert the read status when the save fails", async ({
      bookDetailPage,
      request,
      expectMutation,
      presetReadStatus,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, READ_STATUS_BOOK.title);
      const { readStatusControl } = bookDetailPage;

      await test.step("open the unread book", async () => {
        await presetReadStatus(uuid, "unread");
        await bookDetailPage.goto(uuid);
      });

      await test.step("mark it reading", async () => {
        await expectMutation(readStatus.set(), () =>
          readStatusControl.markReading(),
        );
        await expect(readStatusControl.readingSegment).toHaveClass(/active/);
      });

      await test.step("mark it finished with saves failing", async () => {
        await bookDetailPage.forceServerError(readStatus.set());
        await expectMutation(failing(readStatus.set()), () =>
          readStatusControl.markFinished(),
        );
      });

      // The optimistic pick rolls back and the status line reports it.
      await test.step("check the failure shows", async () => {
        await expect(readStatusControl.readingSegment).toHaveClass(/active/);
        await expect(readStatusControl.meta).toHaveText(
          "Couldn't save — try again",
        );
      });

      await test.step("mark it unread once saves work again", async () => {
        await bookDetailPage.stopForcingServerError(readStatus.set());
        await expectMutation(readStatus.set(), () =>
          readStatusControl.markUnread(),
        );
        await expect(readStatusControl.meta).toHaveText("Not started");
      });
    });
  });

  test.describe("saved passages", () => {
    test.beforeAll(
      "start the passages book empty",
      async ({ request, clearHighlights }) => {
        await clearHighlights(
          await fetchBookUuidByTitle(request, PASSAGES_BOOK.title),
        );
      },
    );

    test("list a saved passage with its locator and note", async ({
      bookDetailPage,
      request,
      highlightOn,
      highlightsRequests,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const { savedPassages } = bookDetailPage;

      const passage =
        await test.step("save a passage with a note", async () => {
          const saved = await highlightOn(uuid, {
            epub_cfi_range: "epubcfi(/6/14[chap03]!/4/2,/1:0,/1:40)",
          });
          await expect(
            await highlightsRequests.patchNote(saved.id, "the line that stuck"),
          ).toBeOK();
          return saved;
        });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      const card = bookDetailPage.savedPassageCard(passage.text);
      await test.step("check the empty state gives way to the card", async () => {
        await expect(savedPassages.emptyMessage).toHaveCount(0);
        await expect(card.root).toHaveCount(1);
        await expect(card.noteText).toHaveText("the line that stuck");
      });

      // The locator names the chapter's TOC title once the book's structure is
      // known (#2463) and the CFI's raw spine step until then (#2356), so only
      // its shape is asserted; the date is the server's created_at.
      await test.step("check the locator and date show", async () => {
        await expect(card.metaText).toContainText(/^.+ · saved /);
      });
    });

    test("delete a saved passage", async ({
      bookDetailPage,
      request,
      expectMutation,
      highlightOn,
      seededHighlightIds,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const { savedPassages } = bookDetailPage;

      const passage = await test.step("save a passage", async () => {
        return highlightOn(uuid, {
          epub_cfi_range: "epubcfi(/6/14[chap03]!/4/2,/1:0,/1:40)",
        });
      });

      const card = bookDetailPage.savedPassageCard(passage.text);
      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(card.root).toHaveCount(1);
      });

      await test.step("delete the passage", async () => {
        await expectMutation(highlights.delete(), () => card.delete());
        seededHighlightIds.delete(passage.id);
      });

      await test.step("check the empty state returns", async () => {
        await expect(savedPassages.quoteText(passage.text)).toHaveCount(0);
        await expect(savedPassages.emptyMessage).toBeVisible();
      });
    });

    test("keep the passage listed when the delete request fails", async ({
      bookDetailPage,
      request,
      expectMutation,
      highlightOn,
      seededHighlightIds,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);

      const passage = await test.step("save a passage", async () => {
        return highlightOn(uuid, {
          epub_cfi_range: "epubcfi(/6/6!/4/2,/1:0,/1:20)",
        });
      });

      const card = bookDetailPage.savedPassageCard(passage.text);
      await test.step("open the book with deletes failing", async () => {
        await bookDetailPage.goto(uuid);
        await expect(card.root).toHaveCount(1);
        await bookDetailPage.forceServerError(highlights.delete());
      });

      await test.step("delete the passage", async () => {
        await expectMutation(failing(highlights.delete()), () => card.delete());
      });

      // The row is only dropped once the server confirms.
      await test.step("check the card is still listed", async () => {
        await expect(card.root).toHaveCount(1);
      });

      await test.step("delete it once deletes work again", async () => {
        await bookDetailPage.stopForcingServerError(highlights.delete());
        await expectMutation(highlights.delete(), () => card.delete());
        seededHighlightIds.delete(passage.id);
        await expect(card.root).toHaveCount(0);
      });
    });

    test("open the reader at a saved passage", async ({
      bookDetailPage,
      epubReaderPage,
      request,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const cfi = "epubcfi(/6/4!/4/2,/1:0,/1:30)";

      const passage = await test.step("save a passage", async () => {
        return highlightOn(uuid, { epub_cfi_range: cfi });
      });

      const card = bookDetailPage.savedPassageCard(passage.text);
      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // The decoded cfi is asserted, not the escaping: the Rust encoder escapes
      // `!()` too, which `encodeURIComponent` leaves alone.
      await test.step("check the link carries the cfi", async () => {
        expect(await card.openTarget()).toEqual({
          pathname: `/read/${uuid}`,
          cfi,
        });
      });

      // The reader boots at the passage instead of resuming where it left off.
      await test.step("open the passage in the reader", async () => {
        await card.openInBook();
        await epubReaderPage.assertPassageOpened(uuid, cfi);
      });
    });

    test("open the quote card editor and close it again", async ({
      bookDetailPage,
      request,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const { quoteCard } = bookDetailPage;

      const passage = await test.step("save a passage", async () => {
        return highlightOn(uuid, {
          epub_cfi_range: "epubcfi(/6/10!/4/2,/1:0,/1:25)",
        });
      });

      const card = bookDetailPage.savedPassageCard(passage.text);
      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("open the editor from the quote", async () => {
        await card.openQuoteCard();
        await expect(quoteCard.root).toBeVisible();
        await expect(quoteCard.heading).toBeVisible();
        await expect(quoteCard.root).toContainText(passage.text);
        await expect(quoteCard.downloadButton).toBeVisible();
        await expect(quoteCard.copyImageButton).toBeVisible();
      });

      // The controls restyle the preview in place, so no request fires.
      await test.step("restyle the preview", async () => {
        await expect(quoteCard.preview).toHaveCSS(
          "font-family",
          /Cormorant Garamond/,
        );
        await quoteCard.pickSans();
        await expect(quoteCard.preview).toHaveCSS(
          "font-family",
          /Instrument Sans/,
        );
        await expect(quoteCard.previewBody).toHaveCSS("font-style", "italic");
        await quoteCard.toggleItalic();
        await expect(quoteCard.previewBody).toHaveCSS("font-style", "normal");
        await quoteCard.toggleBold();
        await expect(quoteCard.previewBody).toHaveCSS("font-weight", "700");
        await quoteCard.pickLargeSize();
        await expect(quoteCard.previewBody).toHaveCSS("font-size", "27px");
      });

      await test.step("close the editor", async () => {
        await quoteCard.close();
        await expect(quoteCard.root).toHaveCount(0);
        await expect(card.root).toHaveCount(1);
      });
    });

    test("list every saved passage with no show more control", async ({
      bookDetailPage,
      request,
      highlightOn,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, PASSAGES_BOOK.title);
      const { savedPassages } = bookDetailPage;

      await test.step("save eight passages", async () => {
        for (let i = 0; i < 8; i++) {
          await highlightOn(uuid, {
            epub_cfi_range: `epubcfi(/6/${4 + i * 2}!/4/2)`,
          });
        }
      });

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // The stop scrolls its list rather than holding rows back.
      await test.step("check all eight cards show without a show more", async () => {
        await expect(savedPassages.cards).toHaveCount(8);
        await expect(savedPassages.showMoreButton).toHaveCount(0);
      });
    });
  });

  test.describe("links from the hero", () => {
    test("open the author page from the authors line", async ({
      bookDetailPage,
      authorPage,
      request,
    }) => {
      // The "by …" line renders the lone author as a link to /authors/:id.
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const author = TARGET.authors[0]!;

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.authorLink(author)).toBeVisible();
      });

      await test.step("follow the author link", async () => {
        await bookDetailPage.openAuthor(author);
        await authorPage.assertDisplayed();
      });
    });

    // `beta` is #1 of "Pioneers", and the Home stop's kicker leads with the
    // series name as a link to /series/:id.
    test("open the series page from the series kicker", async ({
      bookDetailPage,
      seriesPage,
      request,
    }) => {
      const beta = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;
      const uuid = await fetchBookUuidByTitle(request, beta.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
        await expect(bookDetailPage.seriesLink(/Pioneers/)).toBeVisible();
      });

      await test.step("follow the series link", async () => {
        await bookDetailPage.openSeries(/Pioneers/);
        await seriesPage.assertDisplayed();
      });
    });
  });

  // Re-seeds the server with the audiobook fixtures so the audio-only "Start
  // listening" action can be exercised; the describe keeps the other tests on
  // the ebook library seeded above.
  test.describe("audiobook-only library", () => {
    test.beforeAll("seed the audiobook library", async ({ request }) => {
      await seedAudiobookLibrary(
        request,
        audiobookFixturesDir(),
        AUDIOBOOK_BOOK_COUNT,
      );
    });

    // Not the merge pair: this test asserts the absence of a file picker,
    // which a concurrent merge would falsify.
    const SOLO_MP3 = AUDIOBOOK_BOOKS.find(
      (b) =>
        b.format === "MP3" &&
        b.source === "generated" &&
        !MERGE_ONLY_TITLES.includes(b.title),
    )!;

    // An MP3 with no ebook companion has audio and no ebook, so the hero's
    // primary action is Start listening.
    test("open the player from start listening for an audio-only book", async ({
      bookDetailPage,
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, SOLO_MP3.title);

      await test.step("open the book", async () => {
        await bookDetailPage.goto(uuid);
      });

      // #1005: a single-file audiobook shows no file picker next to the action.
      await test.step("check start listening links to the player", async () => {
        await expect(bookDetailPage.startListeningButton).toBeVisible();
        await expect(bookDetailPage.startListeningButton).toHaveAttribute(
          "href",
          new RegExp(`/listen/${uuid}$`),
        );
        await expect(bookDetailPage.listenFilePicker.trigger).toHaveCount(0);
      });

      // #2256: the route carries no trailing "?".
      await test.step("start listening", async () => {
        await bookDetailPage.startListening();
        await listenPage.assertDisplayedFor(uuid);
      });
    });

    // Both merge tests hold the cross-worker audiobook-merge lock, so the wait
    // for another holder plus this run needs the longer timeout.
    test.describe("merged audiobook", () => {
      test.slow();

      test("show a listen file picker after merging two same-format audiobooks", async ({
        bookDetailPage,
        mergedMp3Book: uuid,
      }) => {
        const { listenFilePicker } = bookDetailPage;

        await test.step("open the merged book", async () => {
          await bookDetailPage.goto(uuid);
        });

        // A book with more than one file of the format its action opens offers
        // a way to pick which.
        await test.step("check the picker is offered", async () => {
          await expect(listenFilePicker.trigger).toBeVisible();
          await expect(listenFilePicker.trigger).toHaveText(
            /Start listening\s*▾/,
          );
          await expect(listenFilePicker.panel).toHaveCount(0);
        });

        await test.step("open the picker", async () => {
          await listenFilePicker.open();
          await expect(listenFilePicker.panel).toBeVisible();
          await expect(listenFilePicker.panelHeading).toHaveText(
            "2 files · choose one",
          );
          await expect(listenFilePicker.fileLinks).toHaveCount(2);
          await expect(listenFilePicker.firstFileLink).toContainText(
            "Audiobook ·",
          );
          await expect(listenFilePicker.firstFileLink).toContainText(
            /\d+(?:\.\d+)? [KMGT]?B/,
          );
        });
      });

      test("open the picked file in the player", async ({
        bookDetailPage,
        listenPage,
        mergedMp3Book: uuid,
      }) => {
        const { listenFilePicker } = bookDetailPage;

        await test.step("open the merged book", async () => {
          await bookDetailPage.goto(uuid);
        });

        const manifests = listenFilePicker.recordManifestRequests(uuid);

        // The second, non-default file's id travels with the route and the
        // manifest fetch alike.
        await test.step("pick the second file", async () => {
          await listenFilePicker.choosePart(MERGE_SECONDARY.title);
          await expect
            .poll(() => manifests[0])
            .toMatch(
              new RegExp(`/api/audiobooks/${uuid}/manifest\\?file_id=\\d+$`),
            );
          await listenPage.assertDisplayedFor(uuid, "any");
        });
      });

      // Regression: the app-root driver keyed on the book uuid, which every file
      // shares, so re-picking kept part 1. A window sentinel survives only if no
      // hop fully reloaded; an injected `<a>` would, as dioxus-web routes `Link`s.
      test("reload onto another part when re-picking on the active audiobook", async ({
        bookDetailPage,
        listenPage,
        mergedMp3Book: uuid,
      }) => {
        const { listenFilePicker } = bookDetailPage;

        await test.step("open the merged book", async () => {
          await bookDetailPage.goto(uuid);
          await bookDetailPage.plantFullLoadSentinel();
        });

        const manifests = listenFilePicker.recordManifestRequests(uuid);

        // The book becomes the active playback book with its uuid set.
        const first = await test.step("pick the first part", async () => {
          await listenFilePicker.choosePart("Part 1");
          await listenPage.assertDisplayedFor(uuid, "any");
          await expect.poll(() => manifests.length).toBeGreaterThan(0);
          return manifests[0];
        });

        await test.step("go back to the book", async () => {
          await bookDetailPage.goBack();
          await bookDetailPage.assertDisplayedFor(uuid);
        });

        await test.step("re-pick the second part", async () => {
          await listenFilePicker.choosePart(MERGE_SECONDARY.title);
          await expect
            .poll(() => manifests.at(-1), {
              message: "re-pick must reboot onto a different part",
            })
            .not.toBe(first);
        });

        await test.step("check the session never fully reloaded", async () => {
          expect(
            await bookDetailPage.fullLoadSentinelSurvived(),
            "re-pick nav must stay in-app (no full page load)",
          ).toBe(true);
        });
      });
    });
  });
});
