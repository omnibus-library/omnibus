import { scan, scanUrls } from "../contracts/scan";
import {
  buildExternalBook,
  closeMatch,
  libraryBook,
  notInLibrary,
} from "../data/scan";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// The title search rides on the providers, so its search and its pick
// (`resolve-meta`) are stubbed; the `omnibus_db` wiremock suites cover the
// providers themselves. The form's layout is asserted in `check_in_lookup`.

const QUERY = "name of the wind";
const NAME_OF_THE_WIND = buildExternalBook({
  title: "The Name of the Wind",
  authors: ["Patrick Rothfuss"],
  year: "2008",
  pages: 662,
  publisher: "DAW Books",
  series: "The Kingkiller Chronicle",
  first_publish_year: 2007,
});

test.describe("check-in title search", () => {
  test("pick a title search result into the chooser", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const sequel = buildExternalBook({
      title: "The Wise Man's Fear",
      authors: ["Patrick Rothfuss"],
      first_publish_year: 2011,
    });

    await test.step("search by title", async () => {
      await checkInPage.goto();
      await expect(checkIn.titleSearchForm).toBeVisible();
      await checkIn.stubTitleSearch([NAME_OF_THE_WIND, sequel]);
      await expectMutation(scan.search(QUERY), () =>
        checkIn.searchByTitle(QUERY),
      );
    });

    await test.step("check each result shows its provider facts", async () => {
      await expect(checkIn.searchResultButtons).toHaveCount(2);
      const first = checkIn.searchResultButtons.first();
      await expect(first).toContainText("The Kingkiller Chronicle");
      await expect(first).toContainText("First published 2007");
      await expect(first).toContainText("DAW Books");
      await expect(first).toContainText("662 pages");
    });

    await test.step("pick the first result", async () => {
      await checkIn.stubSearchPick(notInLibrary(NAME_OF_THE_WIND));
      await expectMutation(scan.resolveMeta(), () =>
        checkIn.pickSearchResult(0),
      );
    });

    await test.step("check the chooser shows the richer card", async () => {
      await expect(checkIn.chooseScreen).toBeVisible();
      await expect(checkIn.bookSeriesText).toHaveText(
        "The Kingkiller Chronicle",
      );
      await expect(checkIn.bookDetailText).toContainText(
        "First published 2007",
      );
      await expect(checkIn.ownItButton).toBeVisible();
      await expect(checkIn.addToWishlistButton).toBeVisible();
    });
  });

  // How the mobile shell, whose front door is the camera, reaches the form.
  test("pick a title search result reached from the scanner", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the title search from the scanner", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await checkIn.openTitleSearch();
      await expect(checkIn.titleSearchForm).toBeVisible();
    });

    await test.step("check nothing carried over from a lookup", async () => {
      await expect(checkIn.errorMessage).toHaveCount(0);
      await expect(checkIn.searchEmptyMessage).toHaveCount(0);
    });

    await test.step("search by title and pick the result", async () => {
      await checkIn.stubTitleSearch([NAME_OF_THE_WIND]);
      await checkIn.stubSearchPick(notInLibrary(NAME_OF_THE_WIND));
      await expectMutation(scan.search(QUERY), () =>
        checkIn.searchByTitle(QUERY),
      );
      await expect(checkIn.searchResultButtons).toHaveCount(1);
      await expectMutation(scan.resolveMeta(), () =>
        checkIn.pickSearchResult(0),
      );
      await expect(checkIn.chooseScreen).toBeVisible();
    });
  });

  // #2247: after a title search the ISBN on screen came from the provider, so
  // neither the copy nor the recorded source may call it entered or scanned.
  test("never call a title search result an entered isbn", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const libraryCopy = libraryBook(NAME_OF_THE_WIND, "close-match-uuid", {
      isbn: "9780000000000",
    });

    await test.step("pick a result that matches a library book", async () => {
      await checkInPage.goto();
      await expect(checkIn.titleSearchForm).toBeVisible();
      await checkIn.stubTitleSearch([NAME_OF_THE_WIND]);
      await checkIn.stubSearchPick(closeMatch(NAME_OF_THE_WIND, [libraryCopy]));
      await expectMutation(scan.search(QUERY), () =>
        checkIn.searchByTitle(QUERY),
      );
      await expectMutation(scan.resolveMeta(), () =>
        checkIn.pickSearchResult(0),
      );
    });

    await test.step("check the match names the isbn as found", async () => {
      await expect(checkIn.closeMatchScreen).toBeVisible();
      await expect(checkIn.closeMatchScreen).toContainText(
        NAME_OF_THE_WIND.isbn13,
      );
      await expect(checkIn.closeMatchScreen).not.toContainText("you entered");
      await expect(checkIn.closeMatchScreen).not.toContainText("you scanned");
      await expect(checkIn.closeMatchScreen).not.toContainText("Scanned ISBN");
      await expect(checkIn.closeMatchScreen).not.toContainText("Entered ISBN");
    });

    await test.step("wishlist it as a title search", async () => {
      await checkIn.declineCloseMatch();
      await checkIn.stubWishlistEntry(libraryCopy.uuid);
      await expectMutation(scan.wishlist("search"), () =>
        checkIn.addToWishlist(),
      );
    });
  });

  test("say so when no title matches", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const query = "no such book anywhere";

    await test.step("search for a title nobody has", async () => {
      await checkInPage.goto();
      await expect(checkIn.titleSearchForm).toBeVisible();
      await checkIn.stubTitleSearch([]);
      await expectMutation(scan.search(query), () =>
        checkIn.searchByTitle(query),
      );
    });

    await test.step("check the empty state shows", async () => {
      await expect(checkIn.searchEmptyMessage).toBeVisible();
      await expect(checkIn.searchResultButtons).toHaveCount(0);
    });
  });

  test("stay on the search when it fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("search while searches fail", async () => {
      await checkInPage.goto();
      await expect(checkIn.titleSearchForm).toBeVisible();
      await checkIn.forceServerError(scanUrls.search);
      await expectMutation(failing(scan.search(QUERY)), () =>
        checkIn.searchByTitle(QUERY),
      );
    });

    await test.step("check the error shows over the search", async () => {
      await expect(checkIn.errorMessage).toBeVisible();
      await expect(checkIn.titleSearchForm).toBeVisible();
    });
  });

  test("keep the isbn field beside the search results", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("search by title", async () => {
      await checkInPage.goto();
      await expect(checkIn.titleSearchForm).toBeVisible();
      await checkIn.stubTitleSearch([NAME_OF_THE_WIND]);
      await expectMutation(scan.search(QUERY), () =>
        checkIn.searchByTitle(QUERY),
      );
    });

    await test.step("check both ways in are still on screen", async () => {
      await expect(checkIn.searchResultButtons).toHaveCount(1);
      await expect(checkIn.isbnField).toBeVisible();
      await expect(checkIn.scanBarcodeButton).toBeVisible();
    });
  });
});
