import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bookRequests } from "../contracts/bookRequests";
import { releasesFor } from "../data/bookRequests";
import type { EbookDetail, LibraryBook } from "../data/ebooks";
import { buildExternalBook } from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary, waitForWorkerIdle } from "../utils/seed";

// A configured download client makes the poller act on every picked request, so the tests
// that configure one must not overlap the one that stops at a pick; and every request starts
// a search, so the requests page's tests must not land on another test's mock Prowlarr.
test.describe.configure({ mode: "serial" });

test.describe("book request", () => {
  test.beforeAll("have an ebook library to add to", async ({ request }) => {
    test.setTimeout(300_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    await waitForWorkerIdle(request);
  });

  test("request an ebook from the wishlist and choose a version", async ({
    scanRequests,
    createdBookUuids,
    prowlarrFor,
    wishlistsPage,
    requestsPage,
    expectMutation,
  }) => {
    const book = buildExternalBook();
    const author = book.authors[0];
    let findings!: Awaited<ReturnType<typeof prowlarrFor>>;
    let release!: () => void;

    await test.step("wish for a book the library lacks", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      createdBookUuids.add((await added.json()).book_uuid);
    });

    await test.step("point the search at a Prowlarr that finds two versions", async () => {
      findings = await prowlarrFor(releasesFor(book));
      release = findings.holdSearches();
    });

    await test.step("request the ebook from the wishlist", async () => {
      await wishlistsPage.goto();
      await expect(wishlistsPage.requestButton(book.title)).toBeVisible();
      await expectMutation(bookRequests.start(), () =>
        wishlistsPage.requestEbook(book.title),
      );
      await requestsPage.assertDisplayed();
      await expect(requestsPage.paneTitle).toHaveText(book.title);
    });

    await test.step("see the request looking while the search runs", async () => {
      await expect(requestsPage.paneState).toHaveText("Looking");
      await expect(requestsPage.looking).toBeAttached();
      await expect(requestsPage.versions).toHaveCount(0);
    });

    await test.step("see the versions once the search finishes", async () => {
      release();
      await expect(requestsPage.paneState).toHaveText("Choose a version", {
        timeout: 10_000,
      });
      await expect(requestsPage.versions).toHaveCount(2);
      await expect(requestsPage.bestMatchBadges).toHaveCount(1);
      await expect(
        requestsPage.bestMatchOf(requestsPage.version("EPUB")),
      ).toBeVisible();
      expect(findings.searches).toEqual([`${book.title} ${author}`]);
    });

    await test.step("read where a version came from", async () => {
      const pdf = requestsPage.version("PDF");
      await requestsPage.showDetails();
      await expect(requestsPage.detailsOf(pdf)).toContainText(
        "E2E Library Ink",
      );
      await expect(requestsPage.detailsOf(pdf)).not.toContainText("127.0.0.1");
    });

    await test.step("choose the best match", async () => {
      await expectMutation(bookRequests.choose(), () =>
        requestsPage.choose(requestsPage.version("EPUB")),
      );
      await expect(requestsPage.paneState).toHaveText("Version chosen");
      await expect(requestsPage.chosen).toContainText("EPUB");
      await expect(requestsPage.versions).toHaveCount(0);
    });
  });
  test("a requested ebook reaches Ready to read on the wished book", async ({
    scanRequests,
    ebooksRequests,
    libraryForImports,
    prowlarrFor,
    qbittorrentFor,
    wishlistsPage,
    requestsPage,
    expectMutation,
  }) => {
    test.setTimeout(180_000);
    const book = buildExternalBook();
    let uuid!: string;
    let client!: Awaited<ReturnType<typeof qbittorrentFor>>;
    const epub = join(fixturesDir(), "generated", "alpha.epub");

    await test.step("wish for a book the library lacks", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      uuid = (await added.json()).book_uuid;
      libraryForImports.books.add(uuid);
    });

    await test.step("find versions, and a download client that holds an EPUB", async () => {
      await prowlarrFor(releasesFor(book));
      client = await qbittorrentFor([
        { name: `Release/${book.title}.epub`, bytes: readFileSync(epub) },
      ]);
    });

    await test.step("request the ebook and choose the EPUB", async () => {
      await wishlistsPage.goto();
      await expectMutation(bookRequests.start(), () =>
        wishlistsPage.requestEbook(book.title),
      );
      await expect(requestsPage.versions).toHaveCount(2, {
        timeout: 10_000,
      });
      await expectMutation(bookRequests.choose(), () =>
        requestsPage.choose(requestsPage.version("EPUB")),
      );
    });

    await test.step("see it on its way", async () => {
      await expect(requestsPage.paneState).toHaveText("On its way", {
        timeout: 15_000,
      });
      await expect(requestsPage.percent).toHaveText("40%");
    });

    await test.step("see it ready to read once the download is done", async () => {
      client.finish();
      await expect(requestsPage.paneState).toHaveText("Ready to read", {
        timeout: 90_000,
      });
      await expect(requestsPage.paneCancelButton).toHaveCount(0);
    });

    await test.step("find the EPUB on the book that was wished for, once", async () => {
      const detail = await ebooksRequests.getEbook(uuid);
      await expect(detail).toBeOK();
      const { book_files }: EbookDetail = await detail.json();
      expect(book_files?.map((f) => f.format.toUpperCase())).toEqual(["EPUB"]);
      const listed = await ebooksRequests.getEbooks();
      const { books }: { books: LibraryBook[] } = await listed.json();
      expect(books.filter((b) => b.title === book.title)).toHaveLength(1);
    });

    await test.step("see the book still on the wishlist", async () => {
      await wishlistsPage.goto();
      await expect(wishlistsPage.row(book.title)).toBeVisible();
    });

    await test.step("leave the download where it was", async () => {
      expect(client.deleted).toEqual([]);
      expect(
        existsSync(join(client.saveDir, `Release/${book.title}.epub`)),
      ).toBe(true);
    });
  });

  test("a release with only an executable shows Couldn't add it", async ({
    scanRequests,
    ebooksRequests,
    libraryForImports,
    prowlarrFor,
    qbittorrentFor,
    wishlistsPage,
    requestsPage,
    expectMutation,
  }) => {
    test.setTimeout(180_000);
    const book = buildExternalBook();
    let uuid!: string;

    await test.step("wish for a book, whose download is only an executable", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      uuid = (await added.json()).book_uuid;
      libraryForImports.books.add(uuid);
      await prowlarrFor(releasesFor(book));
      const client = await qbittorrentFor([
        { name: "Release/setup.exe", bytes: Buffer.from("MZ") },
      ]);
      client.finish();
    });

    await test.step("request the ebook and choose the EPUB", async () => {
      await wishlistsPage.goto();
      await expectMutation(bookRequests.start(), () =>
        wishlistsPage.requestEbook(book.title),
      );
      await expect(requestsPage.versions).toHaveCount(2, {
        timeout: 10_000,
      });
      await expectMutation(bookRequests.choose(), () =>
        requestsPage.choose(requestsPage.version("EPUB")),
      );
    });

    await test.step("see Couldn't add it, with a way to try again", async () => {
      await expect(requestsPage.paneState).toHaveText("Couldn’t add it", {
        timeout: 90_000,
      });
      await expect(requestsPage.tryAgain).toBeVisible();
      await expect(requestsPage.stuckDetail).toContainText("no ebook file");
    });

    await test.step("find no file on the book", async () => {
      const detail = await ebooksRequests.getEbook(uuid);
      await expect(detail).toBeOK();
      const { book_files }: EbookDetail = await detail.json();
      expect(book_files ?? []).toHaveLength(0);
    });
  });
});

test.describe("requests page", () => {
  test("show the requests page layout", async ({ requestsPage }) => {
    await test.step("open the requests page", async () => {
      await requestsPage.goto();
    });

    await test.step("check the page and its nav", async () => {
      await requestsPage.assertDisplayed();
      await requestsPage.topNav.assertDisplayed();
      await expect(requestsPage.heading).toBeVisible();
    });
  });

  test("open the requests page from the user menu", async ({
    readerLibraryPage,
    readerRequestsPage,
  }) => {
    await test.step("open the user menu from the library", async () => {
      await readerLibraryPage.goto();
      await readerLibraryPage.topNav.openUserMenu();
    });

    await test.step("follow Requests", async () => {
      await readerLibraryPage.topNav.openRequests();
      await readerRequestsPage.assertDisplayed();
    });
  });

  test("see every reader's requests and cancel your own", async ({
    adminSession,
    scanRequests,
    bookRequestsRequests,
    createdBookUuids,
    prowlarrFor,
    requestsPage,
    readerRequestsPage,
    expectMutation,
  }) => {
    const book = buildExternalBook();
    const admin = adminSession.user;
    let release!: () => void;

    await test.step("start a request that stays looking", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      const { book_uuid } = await added.json();
      createdBookUuids.add(book_uuid);
      release = (await prowlarrFor(releasesFor(book))).holdSearches();
      await expect(await bookRequestsRequests.startRequest(book_uuid)).toBeOK();
    });

    await test.step("see it as another reader, with who asked and no Cancel", async () => {
      await readerRequestsPage.goto();
      await expect(
        readerRequestsPage.itemIn("Looking", book.title),
      ).toContainText("Ebook · looking");
      await readerRequestsPage.select(book.title);
      await expect(readerRequestsPage.paneRequester).toContainText(
        admin.display_name ?? admin.username,
      );
      await expect(readerRequestsPage.paneCancelButton).toHaveCount(0);
    });

    await test.step("cancel it as the reader who asked", async () => {
      await requestsPage.goto();
      await requestsPage.select(book.title);
      await expectMutation(bookRequests.cancel(), () => requestsPage.cancel());
      await expect(requestsPage.paneState).toHaveText("Cancelled");
      await expect(requestsPage.paneCancelButton).toHaveCount(0);
      await expect(requestsPage.itemIn("Looking", book.title)).toHaveCount(0);
      release();
    });

    await test.step("find it under Cancelled, which starts folded", async () => {
      await requestsPage.toggleGroup("Cancelled");
      await expect(requestsPage.itemIn("Cancelled", book.title)).toContainText(
        "Ebook · cancelled",
      );
    });
  });

  test("keep a request going when its cancel fails", async ({
    scanRequests,
    bookRequestsRequests,
    createdBookUuids,
    prowlarrFor,
    requestsPage,
    expectMutation,
  }) => {
    const book = buildExternalBook();
    let release!: () => void;

    await test.step("start a request that stays looking", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      const { book_uuid } = await added.json();
      createdBookUuids.add(book_uuid);
      release = (await prowlarrFor(releasesFor(book))).holdSearches();
      await expect(await bookRequestsRequests.startRequest(book_uuid)).toBeOK();
    });

    await test.step("try to cancel it while the server fails", async () => {
      await requestsPage.goto();
      await requestsPage.select(book.title);
      await requestsPage.forceServerError(bookRequests.cancel());
      await expectMutation(failing(bookRequests.cancel()), () =>
        requestsPage.cancel(),
      );
    });

    await test.step("check it is still looking and the failure is told", async () => {
      await expect(requestsPage.cancelFailedText).toBeVisible();
      await expect(requestsPage.paneState).toHaveText("Looking");
      await expect(requestsPage.itemIn("Looking", book.title)).toBeVisible();
      release();
    });
  });

  test("keep a request on the page once its wish is removed", async ({
    scanRequests,
    physicalRequests,
    bookRequestsRequests,
    createdBookUuids,
    requestsPage,
  }) => {
    const book = buildExternalBook();

    await test.step("request a wished book, then take it off the wishlist", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      const { book_uuid } = await added.json();
      createdBookUuids.add(book_uuid);
      await expect(await bookRequestsRequests.startRequest(book_uuid)).toBeOK();
      await expect(
        await physicalRequests.deleteWishlistEntry(book_uuid),
      ).toBeOK();
    });

    await test.step("still find the request on the requests page", async () => {
      await requestsPage.goto();
      await expect(requestsPage.item(book.title)).toHaveCount(1);
    });
  });
});
