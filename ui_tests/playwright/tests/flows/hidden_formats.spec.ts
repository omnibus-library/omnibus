import { account } from "../contracts/account";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

// A real save on the shared admin would hide the CBZ fixtures from
// `landing.spec.ts`, so the preference is written as the worker's reader.
// comic_reader.spec.ts owns both fixtures' progress writes; these only read.
const COMICS = FIXTURE_BOOKS.filter((book) =>
  book.slug.startsWith("aurora-station-"),
);

test.describe("hidden formats", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the hidden formats layout", async ({ settingsPage }) => {
    const section = settingsPage.account;

    await test.step("open the preferences section", async () => {
      await settingsPage.goto("preferences");
    });

    await test.step("check the card and its nav", async () => {
      await settingsPage.assertDisplayedFor("preferences");
      await settingsPage.topNav.assertDisplayed();
      await expect(section.hiddenFormatsCard).toBeVisible();
      await expect(section.hiddenFormatToggle("cbz")).toBeVisible();
      await expect(section.hiddenFormatToggle("epub")).toBeVisible();
    });
  });

  test("hide cbz from one reader's library only", async ({
    readerSettingsPage,
    readerLibraryPage,
    libraryPage,
    presetHiddenFormats,
  }) => {
    await test.step("hide cbz for the reader", async () => {
      await presetHiddenFormats(["cbz"], "reader");
    });

    // The receipt lands with the list, so waiting on it keeps "no tiles" from
    // passing early. No exact count: other specs reshape the shared library.
    await test.step("check the comics leave the library and the note names them", async () => {
      await readerLibraryPage.goto();
      await expect(readerLibraryPage.hiddenReceipt).toBeVisible();
      await expect(readerLibraryPage.hiddenReceipt).toHaveText(/^\d+ hidden$/);
      await expect(readerLibraryPage.hiddenNote).toContainText("Hidden: CBZ");
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
      await palette.closeWithEscape();
    });

    await test.step("check the note leads to the preference", async () => {
      await readerLibraryPage.openHiddenFormatsNote();
      await readerSettingsPage.assertDisplayedFor("preferences");
      await expect(readerSettingsPage.account.hiddenFormatsCard).toBeVisible();
    });

    await test.step("check the admin still sees them", async () => {
      await libraryPage.goto();
      for (const comic of COMICS) {
        await expect(libraryPage.bookTile(comic.title)).toBeVisible();
      }
      await expect(libraryPage.hiddenReceipt).toHaveCount(0);
      await expect(libraryPage.hiddenNote).toHaveCount(0);
    });
  });

  test("hide a format by ticking it", async ({
    readerSettingsPage,
    presetHiddenFormats,
    readerExpectMutation,
  }) => {
    const section = readerSettingsPage.account;

    await test.step("start with nothing hidden", async () => {
      await presetHiddenFormats([], "reader");
      await readerSettingsPage.goto("preferences");
    });

    await test.step("tick cbz", async () => {
      await readerExpectMutation(account.hiddenFormats(["cbz"]), () =>
        section.setFormatHidden("cbz", true),
      );
    });

    await test.step("check the preference reports it saved", async () => {
      await expect(section.hiddenFormatsStatus).toHaveText("Saved");
    });
  });

  test("show cbz again", async ({
    readerSettingsPage,
    readerLibraryPage,
    presetHiddenFormats,
    readerExpectMutation,
  }) => {
    const section = readerSettingsPage.account;

    await test.step("start with cbz hidden", async () => {
      await presetHiddenFormats(["cbz"], "reader");
    });

    await test.step("untick cbz in the preferences section", async () => {
      await readerSettingsPage.goto("preferences");
      await readerExpectMutation(account.hiddenFormats([]), () =>
        section.setFormatHidden("cbz", false),
      );
      await expect(section.hiddenFormatsStatus).toHaveText("Saved");
    });

    await test.step("check the comics return to the library", async () => {
      await readerLibraryPage.goto();
      for (const comic of COMICS) {
        await expect(readerLibraryPage.bookTile(comic.title)).toBeVisible();
      }
      await expect(readerLibraryPage.hiddenReceipt).toHaveCount(0);
      await expect(readerLibraryPage.hiddenNote).toHaveCount(0);
    });
  });

  test("show a saved format the library doesn't list", async ({
    readerSettingsPage,
    presetHiddenFormats,
    readerExpectMutation,
  }) => {
    const section = readerSettingsPage.account;

    await test.step("start with a format hidden that no book has", async () => {
      await presetHiddenFormats(["djvu"], "reader");
      await readerSettingsPage.goto("preferences");
      await expect(section.hiddenFormatToggle("djvu")).toBeChecked();
    });

    // A plain click, because the box leaves the list once unhidden and
    // uncheck() would wait on a state it can no longer read.
    await test.step("untick it", async () => {
      await readerExpectMutation(account.hiddenFormats([]), () =>
        section.toggleHiddenFormat("djvu"),
      );
    });

    await test.step("check it saved and left the list", async () => {
      await expect(section.hiddenFormatsStatus).toHaveText("Saved");
      await expect(section.hiddenFormatToggle("djvu")).toHaveCount(0);
    });
  });

  test("put a format back when the server refuses the save", async ({
    readerSettingsPage,
    presetHiddenFormats,
    readerExpectMutation,
  }) => {
    const section = readerSettingsPage.account;
    const save = account.hiddenFormats();

    await test.step("start with nothing hidden and the save refused", async () => {
      await presetHiddenFormats([], "reader");
      await readerSettingsPage.goto("preferences");
      await readerSettingsPage.forceServerError(save);
    });

    await test.step("tick cbz", async () => {
      await readerExpectMutation(failing(save), () =>
        section.toggleHiddenFormat("cbz"),
      );
    });

    await test.step("check the tick is put back with an error", async () => {
      await expect(section.hiddenFormatsStatus).toHaveText(/Couldn.t save/);
      await expect(section.hiddenFormatToggle("cbz")).not.toBeChecked();
    });
  });
});
