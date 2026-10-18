import { auth } from "../contracts/auth";
import { progress } from "../contracts/progress";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Account, "Admin · server health" and Notifications were folded into the
// Settings sidebar (#1324), so the menu no longer lists them.

test.describe("user menu", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the user menu layout", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the trigger is closed and the menu is out of reach", async () => {
      await topNav.assertDisplayed();
      await expect(topNav.userMenuButton).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(topNav.signOutButton).toHaveCount(0);
    });
  });

  test("open the user menu", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("click the trigger", async () => {
      await libraryPage.goto();
      await topNav.openUserMenu();
      await expect(topNav.userMenuButton).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    await test.step("check the real actions are there", async () => {
      await expect(topNav.settingsLink).toBeVisible();
      await expect(topNav.signOutButton).toBeVisible();
      await expect(topNav.themeButton("dark")).toBeVisible();
      await expect(topNav.themeButton("light")).toBeVisible();
    });

    await test.step("check the version line", async () => {
      // A compile-time constant (#1055), so it is there whatever OMNIBUS_VERSION is.
      await expect(topNav.versionText).toBeVisible();
      await expect(topNav.versionText).toHaveText(/^v\d+\.\d+\.\d+$/);
    });
  });

  test("close the user menu on a click outside", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the menu", async () => {
      await libraryPage.goto();
      await topNav.openUserMenu();
      await expect(topNav.signOutButton).toBeVisible();
    });

    await test.step("click outside the menu", async () => {
      await topNav.closeUserMenuByClickingOutside();
      await expect(topNav.signOutButton).toHaveCount(0);
      await expect(topNav.userMenuButton).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    await test.step("check the click did not reach the page", async () => {
      await libraryPage.assertDisplayed();
    });
  });

  test("close the user menu on Escape", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the menu", async () => {
      await libraryPage.goto();
      await topNav.openUserMenu();
      await expect(topNav.userMenuPanel).toBeVisible();
    });

    await test.step("press Escape", async () => {
      await topNav.closeUserMenuWithEscape();
      await expect(topNav.signOutButton).toHaveCount(0);
    });
  });

  test("open settings from the user menu", async ({
    libraryPage,
    settingsPage,
  }) => {
    const { topNav } = libraryPage;

    await test.step("click the Settings link", async () => {
      await libraryPage.goto();
      await topNav.openUserMenu();
      await topNav.openSettings();
    });

    await test.step("check the default section opens", async () => {
      await settingsPage.assertDisplayedFor();
    });
  });

  test("leave out the rows folded into Settings", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the menu", async () => {
      await libraryPage.goto();
      await topNav.openUserMenu();
      await expect(topNav.userMenuPanel).toBeVisible();
    });

    await test.step("check Account, server health and Notifications are gone", async () => {
      await expect(topNav.userMenuLink("Account")).toHaveCount(0);
      await expect(topNav.userMenuLink("Admin · server health")).toHaveCount(0);
      await expect(topNav.notificationsText).toHaveCount(0);
    });
  });

  for (const sample of [
    { format: "epub" as const, action: "Continue reading", path: "read" },
    { format: "audio" as const, action: "Continue listening", path: "listen" },
  ]) {
    test(`show the latest ${sample.format} and its resume destination`, async ({
      libraryPage,
      recentBook,
    }) => {
      const { topNav } = libraryPage;
      const latest = await recentBook(sample.format);

      await test.step("open the menu on that reading position", async () => {
        await topNav.stubRecentProgress([latest.point]);
        await libraryPage.goto();
        await topNav.openUserMenu();
      });

      await test.step("check only the action resumes the book", async () => {
        const action = topNav.userMenuLink(`${sample.action} ${latest.title}`);
        await expect(action).toBeVisible();
        // The router trims the bare `?` it writes for an unset `?file_id` (#2256).
        await expect(action).toHaveAttribute(
          "href",
          new RegExp(`^/${sample.path}/${latest.uuid}$`),
        );
      });

      await test.step("check the cover opens the book's details instead", async () => {
        const cover = topNav.userMenuLink(`View details for ${latest.title}`);
        await expect(cover).toHaveAttribute("href", `/books/${latest.uuid}`);
      });
    });
  }

  test("resume the audiobook file the position was taken in", async ({
    libraryPage,
    recentBook,
  }) => {
    const { topNav } = libraryPage;
    // A book can carry more than one audiobook, and a bare `/listen/:uuid`
    // opens the first by ordinal: the wrong narration at the right timestamp.
    const latest = await recentBook("audio", 917);

    await test.step("open the menu on that listening position", async () => {
      await topNav.stubRecentProgress([latest.point]);
      await libraryPage.goto();
      await topNav.openUserMenu();
    });

    await test.step("check the action names the file", async () => {
      await expect(topNav.nowReadingLink).toHaveAttribute(
        "href",
        `/listen/${latest.uuid}?file_id=917`,
      );
    });
  });

  test("show an empty state when no book has progress", async ({
    libraryPage,
  }) => {
    const { topNav } = libraryPage;

    await test.step("open the menu with nothing in progress", async () => {
      await topNav.stubRecentProgress([]);
      await libraryPage.goto();
      await topNav.openUserMenu();
    });

    await test.step("check the empty state shows", async () => {
      await expect(topNav.emptyProgressMessage).toBeVisible();
      await expect(topNav.piranesiText).toHaveCount(0);
    });
  });

  test("report a failed recent-progress fetch", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the menu when the feed fails", async () => {
      await libraryPage.forceServerError(progress.recent());
      await libraryPage.goto();
      await topNav.openUserMenu();
    });

    await test.step("check the failure is reported", async () => {
      await expect(topNav.progressErrorMessage).toHaveText(
        "Unable to load reading progress.",
      );
    });
  });

  test("sign out through the user menu", async ({
    libraryPage,
    loginPage,
    expectMutation,
  }) => {
    const { topNav } = libraryPage;

    await test.step("open the menu", async () => {
      // A real sign-out would end the session every parallel test shares. The
      // backend path has server tests; this one pins the request and the redirect.
      await topNav.stubSignOut();
      await libraryPage.goto();
      await topNav.openUserMenu();
    });

    await test.step("sign out", async () => {
      await expectMutation(auth.logout(), () => topNav.signOut());
    });

    await test.step("check the login page opens", async () => {
      await loginPage.assertDisplayed();
    });
  });

  test("open the account section from the Edit link", async ({
    libraryPage,
    settingsPage,
  }) => {
    const { topNav } = libraryPage;

    await test.step("click Edit", async () => {
      await libraryPage.goto();
      await topNav.openUserMenu();
      await topNav.editProfile();
    });

    await test.step("check Settings opens on the Account section", async () => {
      await settingsPage.assertDisplayedFor("account");
      await expect(settingsPage.account.profileCard).toBeVisible();
    });
  });
});
