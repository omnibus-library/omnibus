import { bookRequests } from "../contracts/bookRequests";
import { releasesFor } from "../data/bookRequests";
import { buildExternalBook } from "../data/scan";
import { expect, test } from "../fixtures/pageFixtures";

test.describe("book request", () => {
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
});
