import { scan } from "../contracts/scan";
import {
  buildExternalBook,
  closeMatch,
  libraryBook,
  notInLibrary,
} from "../data/scan";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// The title search and its pick call the providers, so these tests stub both.

const QUERY = "name of the wind";
const NAME_OF_THE_WIND = buildExternalBook({
  title: "The Name of the Wind",
  authors: ["Patrick Rothfuss"],
  year: "2008",
  pages: 662,
  publisher: "DAW Books",
  format: "Paperback",
  series: "The Kingkiller Chronicle",
  first_publish_year: 2007,
});

test.describe("check-in title search", () => {
  test("pick a title search result into the chooser", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const sequel = buildExternalBook({
      title: "The Wise Man's Fear",
      authors: ["Patrick Rothfuss"],
      first_publish_year: 2011,
    });

    await test.step("search by title", async () => {
      await flow.stubTitleSearch([NAME_OF_THE_WIND, sequel]);
      await checkInPage.goto();
      await expectMutation(scan.search(QUERY), () => flow.searchByTitle(QUERY));
    });

    await test.step("check each result shows its provider facts", async () => {
      const result = flow.searchResultButton(NAME_OF_THE_WIND.title);
      await expect(flow.searchResultButtons).toHaveCount(2);
      await expect(result).toContainText("The Kingkiller Chronicle");
      await expect(result).toContainText("First published 2007");
      await expect(result).toContainText("DAW Books");
      await expect(result).toContainText("Paperback");
      await expect(result).toContainText("662 pages");
      await expect(result).toContainText(`ISBN ${NAME_OF_THE_WIND.isbn13}`);
    });

    await test.step("pick the book from the results", async () => {
      await flow.stubSearchPick(notInLibrary(NAME_OF_THE_WIND));
      await expectMutation(scan.resolveMeta(NAME_OF_THE_WIND), () =>
        flow.pickSearchResult(NAME_OF_THE_WIND.title),
      );
    });

    await test.step("check the chooser shows the richer card", async () => {
      await expect(flow.chooseScreen).toBeVisible();
      await expect(flow.bookSeriesText).toHaveText("The Kingkiller Chronicle");
      await expect(flow.bookDetailText).toContainText("First published 2007");
      await expect(flow.ownItButton).toBeVisible();
      await expect(flow.addToWishlistButton).toBeVisible();
    });
  });

  // The mobile shell opens on the camera, so it reaches the search this way.
  test("pick a title search result reached from the scanner", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open the title search from the scanner", async () => {
      await flow.stubTitleSearch([NAME_OF_THE_WIND]);
      await flow.stubSearchPick(notInLibrary(NAME_OF_THE_WIND));
      await checkInPage.goto();
      await flow.openScanner();
      await flow.openTitleSearch();
      await expect(flow.titleSearchForm).toBeVisible();
    });

    await test.step("check nothing carried over from a lookup", async () => {
      await expect(flow.errorMessage).toHaveCount(0);
      await expect(flow.searchEmptyMessage).toHaveCount(0);
    });

    await test.step("search by title", async () => {
      await expectMutation(scan.search(QUERY), () => flow.searchByTitle(QUERY));
      await expect(flow.searchResultButtons).toHaveCount(1);
    });

    await test.step("pick the book from the results", async () => {
      await expectMutation(scan.resolveMeta(NAME_OF_THE_WIND), () =>
        flow.pickSearchResult(NAME_OF_THE_WIND.title),
      );
      await expect(flow.chooseScreen).toBeVisible();
    });
  });

  // After a title search the ISBN came from the provider, so neither the
  // screen text nor the recorded source may call it entered or scanned (#2247).
  test("never call a title search result an entered isbn", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const libraryCopy = libraryBook(NAME_OF_THE_WIND, "close-match-uuid", {
      isbn: "9780000000000",
    });

    await test.step("pick a result that matches a library book", async () => {
      await flow.stubTitleSearch([NAME_OF_THE_WIND]);
      await flow.stubSearchPick(closeMatch(NAME_OF_THE_WIND, [libraryCopy]));
      await checkInPage.goto();
      await expectMutation(scan.search(QUERY), () => flow.searchByTitle(QUERY));
      await expectMutation(scan.resolveMeta(NAME_OF_THE_WIND), () =>
        flow.pickSearchResult(NAME_OF_THE_WIND.title),
      );
    });

    await test.step("check the match names the isbn as found", async () => {
      await expect(flow.closeMatchScreen).toBeVisible();
      await expect(flow.closeMatchScreen).toContainText(
        NAME_OF_THE_WIND.isbn13,
      );
      await expect(flow.closeMatchScreen).not.toContainText("you entered");
      await expect(flow.closeMatchScreen).not.toContainText("you scanned");
      await expect(flow.closeMatchScreen).not.toContainText("Scanned ISBN");
      await expect(flow.closeMatchScreen).not.toContainText("Entered ISBN");
    });

    await test.step("wishlist it as a title search", async () => {
      await flow.declineCloseMatch();
      await flow.stubWishlistEntry(libraryCopy.uuid);
      await expectMutation(scan.wishlist("search"), () => flow.addToWishlist());
    });
  });

  test("show the empty state when no title matches", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const query = "no such book anywhere";

    await test.step("search for a title nobody has", async () => {
      await flow.stubTitleSearch([]);
      await checkInPage.goto();
      await expectMutation(scan.search(query), () => flow.searchByTitle(query));
    });

    await test.step("check the empty state shows", async () => {
      await expect(flow.searchEmptyMessage).toBeVisible();
      await expect(flow.searchResultButtons).toHaveCount(0);
    });
  });

  test("stay on the search when it fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("search while searches fail", async () => {
      await checkInPage.forceServerError(scan.search(QUERY));
      await checkInPage.goto();
      await expectMutation(failing(scan.search(QUERY)), () =>
        flow.searchByTitle(QUERY),
      );
    });

    await test.step("check the error shows over the search", async () => {
      await expect(flow.errorMessage).toBeVisible();
      await expect(flow.titleSearchForm).toBeVisible();
    });
  });

  test("keep the isbn field beside the search results", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("search by title", async () => {
      await flow.stubTitleSearch([NAME_OF_THE_WIND]);
      await checkInPage.goto();
      await expectMutation(scan.search(QUERY), () => flow.searchByTitle(QUERY));
    });

    await test.step("check both ways in are still on screen", async () => {
      await expect(flow.searchResultButtons).toHaveCount(1);
      await expect(flow.isbnField).toBeVisible();
      await expect(flow.scanBarcodeButton).toBeVisible();
    });
  });
});
