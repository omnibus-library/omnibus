import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bookRequests } from "../contracts/bookRequests";
import { releasesFor } from "../data/bookRequests";
import type { EbookDetail, LibraryBook } from "../data/ebooks";
import { buildExternalBook } from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary, waitForWorkerIdle } from "../utils/seed";

// A configured download client makes the poller act on every picked request, so the tests
// that configure one must not overlap the one that stops at a pick.
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
    bookRequestPage,
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
      await bookRequestPage.assertDisplayed();
      await expect(bookRequestPage.titleHeading).toHaveText(book.title);
    });

    await test.step("see the request looking while the search runs", async () => {
      await expect(bookRequestPage.state).toHaveText("Looking");
      await expect(bookRequestPage.looking).toBeAttached();
      await expect(bookRequestPage.versions).toHaveCount(0);
    });

    await test.step("see the versions once the search finishes", async () => {
      release();
      await expect(bookRequestPage.state).toHaveText("Choose a version", {
        timeout: 10_000,
      });
      await expect(bookRequestPage.versions).toHaveCount(2);
      await expect(bookRequestPage.bestMatchBadges).toHaveCount(1);
      await expect(
        bookRequestPage.bestMatchOf(bookRequestPage.version("EPUB")),
      ).toBeVisible();
      expect(findings.searches).toEqual([`${book.title} ${author}`]);
    });

    await test.step("read where a version came from", async () => {
      const pdf = bookRequestPage.version("PDF");
      await bookRequestPage.showDetails(pdf);
      await expect(bookRequestPage.detailsOf(pdf)).toContainText(
        "E2E Library Ink",
      );
      await expect(bookRequestPage.detailsOf(pdf)).not.toContainText(
        "127.0.0.1",
      );
    });

    await test.step("choose the best match", async () => {
      await expectMutation(bookRequests.choose(), () =>
        bookRequestPage.choose(bookRequestPage.version("EPUB")),
      );
      await expect(bookRequestPage.state).toHaveText("Version chosen");
      await expect(bookRequestPage.chosen).toContainText("EPUB");
      await expect(bookRequestPage.versions).toHaveCount(0);
    });
  });
  test("a requested ebook reaches Ready to read on the wished book", async ({
    scanRequests,
    ebooksRequests,
    libraryForImports,
    prowlarrFor,
    qbittorrentFor,
    wishlistsPage,
    bookRequestPage,
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
      await expect(bookRequestPage.versions).toHaveCount(2, {
        timeout: 10_000,
      });
      await expectMutation(bookRequests.choose(), () =>
        bookRequestPage.choose(bookRequestPage.version("EPUB")),
      );
    });

    await test.step("see it on its way", async () => {
      await expect(bookRequestPage.state).toHaveText("On its way", {
        timeout: 15_000,
      });
      await expect(bookRequestPage.percent).toHaveText("40%");
    });

    await test.step("see it ready to read once the download is done", async () => {
      client.finish();
      await expect(bookRequestPage.state).toHaveText("Ready to read", {
        timeout: 90_000,
      });
      await expect(bookRequestPage.cancel).toHaveCount(0);
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
    bookRequestPage,
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
      await expect(bookRequestPage.versions).toHaveCount(2, {
        timeout: 10_000,
      });
      await expectMutation(bookRequests.choose(), () =>
        bookRequestPage.choose(bookRequestPage.version("EPUB")),
      );
    });

    await test.step("see Couldn't add it, with a way to try again", async () => {
      await expect(bookRequestPage.state).toHaveText("Couldn’t add it", {
        timeout: 90_000,
      });
      await expect(bookRequestPage.tryAgain).toBeVisible();
      await expect(bookRequestPage.stuckDetail).toContainText("no ebook file");
    });

    await test.step("find no file on the book", async () => {
      const detail = await ebooksRequests.getEbook(uuid);
      await expect(detail).toBeOK();
      const { book_files }: EbookDetail = await detail.json();
      expect(book_files ?? []).toHaveLength(0);
    });
  });
});
