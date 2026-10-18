import { account } from "../contracts/account";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// A real save on the shared admin would hide the CBZ fixtures out from under
// `landing.spec.ts` in a parallel worker, so the preference is written as the
// worker's reader. Both CBZ fixtures are reserved for comic_reader.spec.ts's
// progress writes; the assertions here only read them.
const COMICS = FIXTURE_BOOKS.filter((book) =>
  book.slug.startsWith("aurora-station-"),
);

test.describe("hidden formats", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the hidden formats layout", async ({ settingsPage }) => {
    const section = settingsPage.account;

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
    });

    await test.step("check the card and its nav", async () => {
      await settingsPage.assertDisplayed();
      await settingsPage.topNav.assertDisplayed();
      await expect(section.hiddenFormatsCard).toBeVisible();
      await expect(section.hiddenFormatsHeading).toBeVisible();
      await expect(section.hiddenFormatToggle("cbz")).toBeVisible();
      await expect(section.hiddenFormatToggle("epub")).toBeVisible();
      await expect(section.saveHiddenFormatsButton).toBeVisible();
    });
  });

  test("hide cbz from one reader's library only", async ({
    readerSettingsPage,
    readerLibraryPage,
    settingsPage,
    libraryPage,
    presetReaderHiddenFormats,
    readerExpectMutation,
  }) => {
    const section = readerSettingsPage.account;

    await test.step("start with nothing hidden", async () => {
      await presetReaderHiddenFormats([]);
    });

    await test.step("hide cbz in the account section", async () => {
      await readerSettingsPage.goto("account");
      await expect(section.hiddenFormatsCard).toBeVisible();
      await section.setFormatHidden("cbz", true);
      await readerExpectMutation(account.hiddenFormats(), () =>
        section.saveHiddenFormats(),
      );
      await expect(section.hiddenFormatsStatus).toHaveText(
        "Hidden formats saved.",
      );
    });

    // The receipt lands with the list, so waiting on it keeps "no tiles" from
    // passing early. No exact count: other specs reshape the shared library.
    await test.step("check the comics leave the library", async () => {
      await readerLibraryPage.goto();
      await expect(section.landingHiddenReceipt).toBeVisible();
      await expect(section.landingHiddenReceipt).toHaveText(/· \d+ hidden/);
      for (const comic of COMICS) {
        await expect(readerLibraryPage.bookTile(comic.title)).toHaveCount(0);
      }
    });

    // The exclusion is landing-only: search still finds the hidden comic.
    await test.step("check search still finds them", async () => {
      const palette = readerLibraryPage.topNav.searchPalette;
      await palette.search("Aurora Station");
      await expect
        .poll(async () => palette.row("book").count())
        .toBeGreaterThan(0);
    });

    await test.step("check the admin still sees them", async () => {
      await libraryPage.goto();
      for (const comic of COMICS) {
        await expect(libraryPage.bookTile(comic.title)).toBeVisible();
      }
      await expect(settingsPage.account.landingHiddenReceipt).toHaveCount(0);
    });
  });

  test("show cbz again", async ({
    readerSettingsPage,
    readerLibraryPage,
    presetReaderHiddenFormats,
    readerExpectMutation,
  }) => {
    const section = readerSettingsPage.account;

    await test.step("start with cbz hidden", async () => {
      await presetReaderHiddenFormats(["cbz"]);
    });

    await test.step("show cbz in the account section", async () => {
      await readerSettingsPage.goto("account");
      await expect(section.hiddenFormatsCard).toBeVisible();
      await section.setFormatHidden("cbz", false);
      await readerExpectMutation(account.hiddenFormats(), () =>
        section.saveHiddenFormats(),
      );
      await expect(section.hiddenFormatsStatus).toHaveText(
        "Hidden formats saved.",
      );
    });

    await test.step("check the comics return to the library", async () => {
      await readerLibraryPage.goto();
      for (const comic of COMICS) {
        await expect(readerLibraryPage.bookTile(comic.title)).toBeVisible();
      }
      await expect(section.landingHiddenReceipt).toHaveCount(0);
    });
  });
});
