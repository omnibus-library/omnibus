import { account } from "../contracts/account";
import { kobo } from "../contracts/kobo";
import type { CreatedKoboDevice } from "../data/account";
import { uniqueSuffix } from "../data/unique";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { TEST_PASSWORD } from "../utils/auth";

// The suite's seeded session is an admin, a superset of the plain-user surface
// these sections need. The Account section holds the profile, password and
// goals, Kindle the Send-to-Kindle address, Kobo the wireless-sync devices.

test.describe("account section", () => {
  test("show the account section layout", async ({ settingsPage }) => {
    const section = settingsPage.account;

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.assertDisplayed();
      await settingsPage.topNav.assertDisplayed();
      await expect(settingsPage.sectionLink("account")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await test.step("check the profile and password cards", async () => {
      await expect(section.profileCard).toBeVisible();
      await expect(section.displayNameField).toBeVisible();
      await expect(section.saveDisplayNameButton).toBeVisible();
      await expect(section.passwordHeading).toBeVisible();
      await expect(section.passwordCard).toBeVisible();
      await expect(section.currentPasswordField).toBeVisible();
      await expect(section.newPasswordField).toBeVisible();
      await expect(section.changePasswordButton).toBeVisible();
    });

    // One row per setting, so a new one is a row rather than another card.
    await test.step("check the feature switches", async () => {
      await expect(section.userSettingsCard).toBeVisible();
      await expect(section.userSettingsHeading).toBeVisible();
      await expect(section.userSettingsTable).toBeVisible();
      await expect(section.scrollStopsRow).toBeVisible();
      await expect(section.scrollStopsSwitch).toBeEnabled();
      await expect(section.scrollStopsSoonNote).toHaveCount(0);
      await expect(section.shareStatsRow).toBeVisible();
      await expect(section.shareStatsSwitch).toBeEnabled();
    });

    // Its behaviour is covered by hidden_formats.spec.ts.
    await test.step("check the hidden formats card", async () => {
      await expect(section.hiddenFormatsCard).toBeVisible();
    });

    await test.step("check kindle and kobo have their own sections", async () => {
      await expect(settingsPage.kindle.card).toHaveCount(0);
      await expect(settingsPage.kobo.devicesCard).toHaveCount(0);
    });
  });

  test("redirect the legacy account route into the account section", async ({
    settingsPage,
  }) => {
    await test.step("open the legacy route", async () => {
      await settingsPage.gotoLegacyAccountRoute();
    });

    await test.step("check the settings page shows the password card", async () => {
      await settingsPage.assertDisplayed();
      await expect(settingsPage.account.passwordCard).toBeVisible();
    });
  });
});

test.describe("kindle section", () => {
  test("show the kindle section layout", async ({ settingsPage }) => {
    const kindle = settingsPage.kindle;

    await test.step("open the kindle section", async () => {
      await settingsPage.goto("kindle");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.assertDisplayed();
      await settingsPage.topNav.assertDisplayed();
      await expect(settingsPage.sectionLink("kindle")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await test.step("check the kindle card", async () => {
      await expect(kindle.heading).toBeVisible();
      await expect(kindle.card).toBeVisible();
      await expect(kindle.emailField).toBeVisible();
      await expect(kindle.saveButton).toBeVisible();
      await expect(kindle.connectedMarker).toBeAttached();
    });
  });

  test("save the kindle email", async ({
    settingsPage,
    presetKindleEmail,
    expectMutation,
  }) => {
    const kindle = settingsPage.kindle;
    const address = "reader@kindle.com";

    await test.step("start with no address", async () => {
      await presetKindleEmail(null);
      await settingsPage.goto("kindle");
    });

    await test.step("save an address", async () => {
      await expectMutation(account.kindleEmail(address), () =>
        kindle.saveEmail(address),
      );
    });

    await test.step("check the success status", async () => {
      await expect(kindle.statusMessage).toHaveText("Kindle email saved.");
      await expect(kindle.statusMessage).toHaveClass(/success/);
    });
  });

  test("show an error status when saving the kindle email fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const kindle = settingsPage.kindle;

    await test.step("open the kindle section", async () => {
      await settingsPage.goto("kindle");
      await settingsPage.forceServerError(account.kindleEmail());
    });

    await test.step("save an address", async () => {
      await expectMutation(failing(account.kindleEmail()), () =>
        kindle.saveEmail("reader@kindle.com"),
      );
    });

    await test.step("check the error status", async () => {
      await expect(kindle.statusMessage).toHaveClass(/error/);
    });
  });
});

test.describe("kobo section", () => {
  test("show the kobo section layout", async ({ settingsPage }) => {
    await test.step("open the kobo section", async () => {
      await settingsPage.goto("kobo");
    });

    await test.step("check the settings frame and the devices card", async () => {
      await settingsPage.assertDisplayed();
      await settingsPage.topNav.assertDisplayed();
      await expect(settingsPage.sectionLink("kobo")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(settingsPage.kobo.devicesCard).toBeVisible();
    });
  });

  test("add a kobo device with an absolute endpoint url", async ({
    settingsPage,
    createdKoboDeviceIds,
    expectMutation,
  }) => {
    const devices = settingsPage.kobo;
    const name = `E2E Kobo ${uniqueSuffix()}`;

    await test.step("open the kobo section", async () => {
      await settingsPage.goto("kobo");
    });

    await test.step("add a device", async () => {
      const { response } = await expectMutation(kobo.create(name), () =>
        devices.addDevice(name),
      );
      const created: CreatedKoboDevice = await response.json();
      createdKoboDeviceIds.add(created.id);
    });

    // A Kobo on its own Wi-Fi can't resolve a bare path against the web app's origin.
    await test.step("check its endpoint is a full url", async () => {
      await expect(devices.endpointField(name)).toHaveValue(
        /^https?:\/\/[^/]+\/kobo\/[^/]+$/,
      );
    });
  });

  test("remove a kobo device", async ({
    settingsPage,
    ownKoboDevice,
    createdKoboDeviceIds,
    expectMutation,
  }) => {
    const devices = settingsPage.kobo;
    const name = `E2E Kobo ${uniqueSuffix()}`;

    const id = await test.step("add a device through the api", () =>
      ownKoboDevice(name));

    await test.step("open the kobo section", async () => {
      await settingsPage.goto("kobo");
    });

    await test.step("remove the device", async () => {
      await expectMutation(kobo.revoke(id), () => devices.removeDevice(name));
      createdKoboDeviceIds.delete(id);
    });
  });
});

// The success test stubs the write: a real change would strand every later
// sign-in as this admin. The rejection tests hit the live server, which refuses
// both before it writes.
test.describe("password", () => {
  test("change the password and clear the form", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;
    const replacement = "Brand-New-Valid-9x";

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
      await section.stubPasswordChanged();
    });

    await test.step("change the password", async () => {
      await expectMutation(
        account.changePassword(TEST_PASSWORD, replacement),
        () => section.changePassword(TEST_PASSWORD, replacement),
      );
    });

    await test.step("check the success status and the cleared form", async () => {
      await expect(section.passwordStatus).toHaveText("Password changed.");
      await expect(section.passwordStatus).toHaveClass(/success/);
      await expect(section.currentPasswordField).toHaveValue("");
      await expect(section.newPasswordField).toHaveValue("");
    });
  });

  test("reject a wrong current password", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;
    const wrong = "definitely-not-the-password";

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
    });

    await test.step("change the password with the wrong current one", async () => {
      await expectMutation(
        account.changePassword(wrong, "Brand-New-Valid-9x", 500),
        () => section.changePassword(wrong, "Brand-New-Valid-9x"),
      );
    });

    // The inputs keep their values so the user can correct just the current one.
    await test.step("check the error shows and the form is untouched", async () => {
      await expect(section.passwordStatus).toHaveClass(/error/);
      await expect(section.passwordStatus).toContainText(
        "current password is incorrect",
      );
      await expect(section.currentPasswordField).toHaveValue(wrong);
    });
  });

  // The correct current password authorizes; the server's policy then refuses a
  // too-short new one before any write.
  test("reject an invalid new password", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
    });

    await test.step("change the password to a short one", async () => {
      await expectMutation(
        account.changePassword(TEST_PASSWORD, "short", 500),
        () => section.changePassword(TEST_PASSWORD, "short"),
      );
    });

    await test.step("check the error status", async () => {
      await expect(section.passwordStatus).toHaveClass(/error/);
    });
  });
});

// The display name is visible everywhere (it relabels the wishlist shelf and
// every byline), so the success test restores it and the failure test stubs.
test.describe("profile", () => {
  test("save the display name", async ({
    settingsPage,
    presetDisplayName,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with no display name", async () => {
      await presetDisplayName(null);
      await settingsPage.goto("account");
    });

    await test.step("save a name", async () => {
      await expectMutation(account.profile("Seamus"), () =>
        section.saveDisplayName("Seamus"),
      );
    });

    await test.step("check the success status", async () => {
      await expect(section.profileStatus).toHaveText("Profile saved.");
      await expect(section.profileStatus).toHaveClass(/success/);
    });

    // The card re-reads `/api/auth/me` after the save, so no reload is needed.
    await test.step("check the user menu shows the name", async () => {
      await settingsPage.topNav.openUserMenu();
      await expect(settingsPage.topNav.userMenuPanel).toContainText("Seamus");
    });
  });

  test("show an error status when saving the display name fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
      await settingsPage.forceServerError(account.profile());
    });

    await test.step("save a name", async () => {
      await expectMutation(failing(account.profile()), () =>
        section.saveDisplayName("Seamus"),
      );
    });

    await test.step("check the error status", async () => {
      await expect(section.profileStatus).toHaveClass(/error/);
    });
  });

  test("confirm a saved profile picture", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
      await section.stubAvatarUpload(204);
    });

    await test.step("upload a picture", async () => {
      await expectMutation(account.avatar(), () => section.uploadAvatar());
    });

    await test.step("check the success status", async () => {
      await expect(section.profileStatus).toHaveText("Profile picture saved.");
      await expect(section.profileStatus).toHaveClass(/success/);
    });
  });

  test("clear the picture confirmation when the next upload starts", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("save a picture", async () => {
      await settingsPage.goto("account");
      await section.stubAvatarUpload(204);
      await expectMutation(account.avatar(), () => section.uploadAvatar());
      await expect(section.profileStatus).toHaveText("Profile picture saved.");
    });

    await test.step("upload another that fails", async () => {
      await section.stubAvatarUpload(400);
      await expectMutation(account.avatar(400), () => section.uploadAvatar());
    });

    // A confirmation left from the last write must not pass for this one's.
    await test.step("check the error replaces the confirmation", async () => {
      await expect(section.avatarStatus).toHaveClass(/error/);
      await expect(section.profileStatus).toHaveCount(0);
    });
  });

  test("show an error when the avatar upload fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("open the account section", async () => {
      await settingsPage.goto("account");
      await section.stubAvatarUpload(400);
    });

    await test.step("upload a picture", async () => {
      await expectMutation(account.avatar(400), () => section.uploadAvatar());
    });

    await test.step("check the error status", async () => {
      await expect(section.avatarStatus).toBeVisible();
      await expect(section.avatarStatus).toHaveClass(/error/);
    });
  });
});

// The five goal tests reset the same three per-user rows, so they run one at a
// time; the rest of the account surface keeps its parallelism.
test.describe("reading goals", () => {
  test.describe.configure({ mode: "serial" });

  test("set all three goals behind one control", async ({
    settingsPage,
    presetGoals,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with no goals", async () => {
      await presetGoals();
      await settingsPage.goto("account");
    });

    // Every kind states its target or that it has none, and one control edits them all.
    await test.step("check the card is read-only with one control", async () => {
      await expect(section.goalsCard).toBeVisible();
      await expect(section.goalsHeading).toBeVisible();
      await expect(section.goalValue("books")).toHaveText("Not set");
      await expect(section.goalValue("pages")).toHaveText("Not set");
      await expect(section.goalValue("minutes")).toHaveText("Not set");
      await expect(section.goalsCardButtons).toHaveCount(1);
      await expect(section.editGoalsButton).toBeVisible();
    });

    await test.step("edit the three goals", async () => {
      await section.editGoals();
      await section.fillGoal("books", "24");
      await section.fillGoal("pages", "30");
      await section.fillGoal("minutes", "45");
    });

    // The annual and daily routes can't be batched, so one Save fans out into
    // per-kind writes and reports what landed.
    await test.step("save", async () => {
      await expectMutation(account.annualGoal(24), () => section.saveGoals());
    });

    await test.step("check the saved goals", async () => {
      await expect(section.goalsStatus).toHaveText("Goals saved.");
      await expect(section.goalValue("books")).toHaveText("24 books");
      await expect(section.goalValue("pages")).toHaveText("30 pages");
      await expect(section.goalValue("minutes")).toHaveText("45 minutes");
    });

    // The card reads all three back off the server, which tells an optimistic
    // render apart from a real write.
    await test.step("check the goals survive a reload", async () => {
      await settingsPage.reload();
      await expect(section.goalValue("books")).toHaveText("24 books");
      await expect(section.goalValue("pages")).toHaveText("30 pages");
      await expect(section.goalValue("minutes")).toHaveText("45 minutes");
    });
  });

  test("clear a goal by emptying its field", async ({
    settingsPage,
    presetGoals,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with an annual and a pages goal", async () => {
      await presetGoals({ books: 24, pages: 30 });
      await settingsPage.goto("account");
    });

    // Blanking is how a single form drops a goal: there is no Clear per row.
    await test.step("empty the pages field and save", async () => {
      await section.editGoals();
      await section.fillGoal("pages", "");
      await expectMutation(account.dailyGoal("pages"), () =>
        section.saveGoals(),
      );
    });

    // Only changed kinds are written, so another device's value can't be
    // clobbered by a no-op save.
    await test.step("check only the pages goal cleared", async () => {
      await expect(section.goalValue("pages")).toHaveText("Not set");
      await expect(section.goalValue("books")).toHaveText("24 books");
    });
  });

  test("refuse an out-of-range target before it costs a round trip", async ({
    settingsPage,
    presetGoals,
  }) => {
    const section = settingsPage.account;

    await test.step("start with no goals", async () => {
      await presetGoals();
      await settingsPage.goto("account");
    });

    // 1,500 is a legal day of pages and an impossible day of minutes.
    await test.step("save 1500 pages and 1500 minutes", async () => {
      await section.editGoals();
      await section.fillGoal("pages", "1500");
      await section.fillGoal("minutes", "1500");
      await section.saveGoals();
    });

    await test.step("check the minutes field is refused and nothing is written", async () => {
      await expect(section.goalsStatus).toContainText("Minutes a day");
      await expect(section.goalsStatus).toContainText("1440");
      await expect(section.goalField("pages")).toHaveValue("1500");
    });
  });

  test("name the goal that failed to save", async ({
    settingsPage,
    presetGoals,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with no goals", async () => {
      await presetGoals();
      await settingsPage.goto("account");
      await settingsPage.forceServerError(account.dailyGoal("pages", 30));
    });

    await test.step("save an annual and a pages goal", async () => {
      await section.editGoals();
      await section.fillGoal("books", "24");
      await section.fillGoal("pages", "30");
      await expectMutation(failing(account.dailyGoal("pages", 30)), () =>
        section.saveGoals(),
      );
    });

    // Three goals are three writes, so the reader needs to know which to retry.
    await test.step("check the status names the pages goal", async () => {
      await expect(section.goalsStatus).toContainText("Pages a day");
      await expect(section.goalsStatus).toHaveClass(/error/);
    });

    // The annual write landed, and the form stays open on the failure.
    await test.step("check the form stays open", async () => {
      await expect(section.goalField("books")).toHaveValue("24");
    });
  });

  test("cancel goal edits back to what the server confirmed", async ({
    settingsPage,
    presetGoals,
  }) => {
    const section = settingsPage.account;

    await test.step("start with an annual goal", async () => {
      await presetGoals({ books: 24 });
      await settingsPage.goto("account");
    });

    await test.step("edit the annual goal and cancel", async () => {
      await section.editGoals();
      await section.fillGoal("books", "99");
      await section.cancelGoals();
    });

    await test.step("check the draft is dropped", async () => {
      await expect(section.goalValue("books")).toHaveText("24 books");
      await section.editGoals();
      await expect(section.goalField("books")).toHaveValue("24");
    });
  });
});

// The shared admin's share-stats flag is per-account state every other spec
// reads as on, so these run one at a time and begin and end with it on.
test.describe("share stats", () => {
  test.describe.configure({ mode: "serial" });

  test("turn share stats off", async ({
    settingsPage,
    presetShareStats,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with sharing on", async () => {
      await presetShareStats(true);
      await settingsPage.goto("account");
      await expect(section.shareStatsSwitch).toBeChecked();
      await expect(section.shareStatsRow).toContainText(
        "Other readers on this server can see your stats page.",
      );
    });

    await test.step("flip the switch", async () => {
      await expectMutation(account.shareStats(false), () =>
        section.toggleShareStats(),
      );
      await expect(section.shareStatsSwitch).not.toBeChecked();
    });

    await test.step("check it survives a reload", async () => {
      await settingsPage.reload();
      await expect(section.shareStatsSwitch).not.toBeChecked();
      await expect(section.shareStatsRow).toContainText(
        "Only you can see your stats page.",
      );
    });
  });

  test("put the share stats switch back when the save fails", async ({
    settingsPage,
    presetShareStats,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with sharing on", async () => {
      await presetShareStats(true);
      await settingsPage.goto("account");
      await expect(section.shareStatsSwitch).toBeChecked();
      await settingsPage.forceServerError(account.shareStats());
    });

    await test.step("flip the switch", async () => {
      await expectMutation(failing(account.shareStats(false)), () =>
        section.toggleShareStats(),
      );
    });

    await test.step("check the switch is back on with an error", async () => {
      await expect(section.shareStatsSwitch).toBeChecked();
      await expect(section.shareStatsError).toBeVisible();
    });
  });
});
