import { account } from "../contracts/account";
import { kobo } from "../contracts/kobo";
import type { CreatedKoboDevice } from "../data/account";
import { uniqueSuffix } from "../data/unique";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { TEST_PASSWORD } from "../utils/auth";

// The suite's seeded session is an admin, a superset of the plain-user surface
// these sections need. Profile holds the display name and picture, Preferences
// the switches and hidden formats, Goals the reading targets, Devices the
// Kindle address and Kobo sync, and Sign-in & security the password and
// sessions. The admin's stack series, hidden formats and scroll stops are read
// by other specs, so this file only checks that their controls render.

test.describe("profile section", () => {
  test("show the profile section layout", async ({ settingsPage }) => {
    const section = settingsPage.account;

    await test.step("open the profile section", async () => {
      await settingsPage.goto("profile");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.assertDisplayed();
      await settingsPage.topNav.assertDisplayed();
      await expect(settingsPage.sectionLink("profile")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await test.step("check the profile card", async () => {
      await expect(section.profileCard).toBeVisible();
      await expect(section.profileHeading).toBeVisible();
      await expect(section.displayNameField).toBeVisible();
      // Nothing to save until the name changes.
      await expect(section.saveDisplayNameButton).toBeDisabled();
    });

    // The picker's file input is visually hidden but still in the tab order.
    await test.step("check the picture picker takes keyboard focus", async () => {
      await section.focusAvatarPicker();
      await expect(section.avatarFileInput).toBeFocused();
    });

    await test.step("check the password lives elsewhere", async () => {
      await expect(section.passwordCard).toHaveCount(0);
    });
  });

  test("redirect the legacy account route into settings", async ({
    settingsPage,
  }) => {
    await test.step("open the legacy route", async () => {
      await settingsPage.gotoLegacy("/account");
    });

    await test.step("check the settings page shows the profile card", async () => {
      await settingsPage.assertDisplayedFor();
      await expect(settingsPage.account.profileCard).toBeVisible();
    });
  });
});

test.describe("preferences section", () => {
  test("show the preferences section layout", async ({ settingsPage }) => {
    const section = settingsPage.account;

    await test.step("open the preferences section", async () => {
      await settingsPage.goto("preferences");
    });

    await test.step("check the settings frame", async () => {
      await expect(settingsPage.sectionLink("preferences")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await settingsPage.topNav.assertDisplayed();
    });

    await test.step("check the preference groups", async () => {
      for (const group of ["Appearance", "Library", "Book page", "Privacy"]) {
        await expect(section.preferenceGroup(group)).toBeVisible();
      }
      await expect(section.deviceNote).toBeVisible();
      await expect(section.themeButton("dark")).toBeVisible();
    });

    await test.step("check the switches are offered", async () => {
      await expect(section.stackSeriesSwitch).toBeEnabled();
      await expect(section.scrollStopsSwitch).toBeEnabled();
      await expect(section.shareStatsSwitch).toBeEnabled();
    });

    // Hidden formats is one labelled group that saves on change; its behaviour
    // is covered by hidden_formats.spec.ts.
    await test.step("check the hidden formats group", async () => {
      await expect(section.hiddenFormatsGroup).toBeVisible();
      await expect(section.hiddenFormatToggle("epub")).toBeVisible();
      await expect(section.saveHiddenFormatsButton).toHaveCount(0);
    });
  });
});

test.describe("devices section", () => {
  test("show the devices section layout", async ({ settingsPage }) => {
    const { kindle, kobo: devices } = settingsPage;

    await test.step("open the devices section", async () => {
      await settingsPage.goto("devices");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.assertDisplayed();
      await settingsPage.topNav.assertDisplayed();
      await expect(settingsPage.sectionLink("devices")).toHaveAttribute(
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
      await expect(kindle.delivery).toBeVisible();
    });

    await test.step("check the kobo card", async () => {
      await expect(devices.devicesCard).toBeVisible();
      await expect(devices.dataLossWarning).toBeVisible();
      await expect(devices.setupToggle).toBeVisible();
      await expect(devices.shelvesLink).toHaveAttribute("href", "/shelves");
    });
  });

  // Delivery readiness is instance configuration (an SMTP relay), so the two
  // states are stubbed rather than set up on the shared server.
  test("name the sender to approve when kindle delivery is ready", async ({
    settingsPage,
  }) => {
    const { kindle } = settingsPage;

    await test.step("open the devices section with delivery ready", async () => {
      await kindle.stubDelivery("library@example.com");
      await settingsPage.goto("devices");
    });

    await test.step("check the sender is named and copyable", async () => {
      await expect(kindle.delivery).toContainText(
        "Approve library@example.com",
      );
      await expect(kindle.senderCopyButton).toBeVisible();
    });
  });

  test("link an admin to integrations when kindle delivery isn't set up", async ({
    settingsPage,
  }) => {
    const { kindle } = settingsPage;

    await test.step("open the devices section with no sender", async () => {
      await kindle.stubDelivery(null);
      await settingsPage.goto("devices");
    });

    await test.step("check the way to email delivery shows", async () => {
      await expect(kindle.emailDeliveryLink).toHaveAttribute(
        "href",
        "/admin?section=integrations",
      );
    });
  });

  // These three write the shared admin's address, so they run one at a time.
  test.describe("kindle email", () => {
    test.describe.configure({ mode: "serial" });

    test("save the kindle email", async ({
      settingsPage,
      presetKindleEmail,
      expectMutation,
    }) => {
      const kindle = settingsPage.kindle;
      const address = "reader@kindle.com";

      await test.step("start with no address", async () => {
        await presetKindleEmail(null);
        await settingsPage.goto("devices");
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

    test("ask before clearing the kindle email", async ({
      settingsPage,
      presetKindleEmail,
    }) => {
      const kindle = settingsPage.kindle;
      const address = "reader@kindle.com";

      await test.step("start with an address saved", async () => {
        await presetKindleEmail(address);
        await settingsPage.goto("devices");
      });

      const writes = kindle.recordEmailWrites();

      await test.step("ask to clear it and back out", async () => {
        await kindle.startClear();
        await expect(kindle.clearDialog).toContainText(address);
        await kindle.cancelClear();
      });

      await test.step("check the dialog closed and nothing was sent", async () => {
        await expect(kindle.clearDialog).toHaveCount(0);
        expect(writes).toEqual([]);
      });
    });

    test("clear the kindle email once the named address is confirmed", async ({
      settingsPage,
      presetKindleEmail,
      expectMutation,
    }) => {
      const kindle = settingsPage.kindle;

      await test.step("start with an address saved", async () => {
        await presetKindleEmail("reader@kindle.com");
        await settingsPage.goto("devices");
      });

      await test.step("ask to clear it and confirm", async () => {
        await kindle.startClear();
        await expectMutation(account.kindleEmail(null), () =>
          kindle.confirmClear(),
        );
      });

      await test.step("check the dialog closed and the email cleared", async () => {
        await expect(kindle.clearDialog).toHaveCount(0);
        await expect(kindle.statusMessage).toHaveText("Kindle email cleared.");
      });
    });
  });

  test("show an error status when saving the kindle email fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const kindle = settingsPage.kindle;

    await test.step("open the devices section", async () => {
      await settingsPage.goto("devices");
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

  test("add a kobo device with an absolute endpoint url", async ({
    settingsPage,
    createdKoboDeviceIds,
    expectMutation,
  }) => {
    const devices = settingsPage.kobo;
    const name = `E2E Kobo ${uniqueSuffix()}`;

    await test.step("open the devices section", async () => {
      await settingsPage.goto("devices");
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

    await test.step("check the device joins the list below the form", async () => {
      expect(await devices.topEdge(devices.deviceRow(name))).toBeGreaterThan(
        await devices.topEdge(devices.addButton),
      );
    });
  });

  test("ask before regenerating a kobo token", async ({
    settingsPage,
    ownKoboDevice,
  }) => {
    const devices = settingsPage.kobo;
    const name = `E2E Kobo ${uniqueSuffix()}`;

    await test.step("add a device through the api", async () => {
      await ownKoboDevice(name);
    });

    await test.step("open the devices section", async () => {
      await settingsPage.goto("devices");
    });

    const regenerates = devices.recordRegenerates();

    await test.step("ask to regenerate it and back out", async () => {
      await devices.startRegenerate(name);
      await expect(devices.regenerateConfirmation(name)).toBeVisible();
      await devices.cancelRegenerate();
    });

    await test.step("check the dialog closed and nothing was sent", async () => {
      await expect(devices.regenerateDialog).toHaveCount(0);
      expect(regenerates).toEqual([]);
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

    // Removing asks first, naming the device it would stop syncing.
    await test.step("ask to remove the device", async () => {
      await settingsPage.goto("devices");
      await devices.startRemove(name);
      await expect(devices.removeConfirmation(name)).toBeVisible();
    });

    await test.step("confirm the removal", async () => {
      await expectMutation(kobo.revoke(id), () => devices.confirmRemove());
      createdKoboDeviceIds.delete(id);
    });

    await test.step("check the dialog closed and the device is gone", async () => {
      await expect(devices.removeDialog).toHaveCount(0);
      await expect(devices.deviceRow(name)).toHaveCount(0);
    });
  });

  // The device list is per-user state on the shared admin, so both disclosure
  // states are stubbed: whether it opens on its own depends on the list.
  test("open the kobo setup steps from their disclosure", async ({
    settingsPage,
  }) => {
    const devices = settingsPage.kobo;

    await test.step("open the devices section with one kobo", async () => {
      await devices.stubDevices([{ id: 1, name: "Kobo Clara" }]);
      await settingsPage.goto("devices");
      await expect(devices.deviceRows).toHaveCount(1);
    });

    await test.step("check the steps start folded away", async () => {
      await expect(devices.setupSteps).toBeHidden();
    });

    await test.step("open the steps", async () => {
      await devices.openSetupSteps();
      await expect(devices.setupSteps).toBeVisible();
      await expect(devices.backupToolLink()).toHaveAttribute(
        "href",
        "https://github.com/omnibus-library/kobo-backup",
      );
    });
  });

  test("show the kobo setup steps to a reader with no kobo yet", async ({
    settingsPage,
  }) => {
    const devices = settingsPage.kobo;

    await test.step("open the devices section with no kobo", async () => {
      await devices.stubDevices([]);
      await settingsPage.goto("devices");
    });

    await test.step("check the steps are already open", async () => {
      await expect(devices.emptyMessage).toBeVisible();
      await expect(devices.setupSteps).toBeVisible();
    });
  });
});

test.describe("security section", () => {
  test("show the sign-in and security section layout", async ({
    settingsPage,
  }) => {
    const section = settingsPage.account;

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.topNav.assertDisplayed();
      await expect(settingsPage.sectionLink("security")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await test.step("check the password, sessions and token cards", async () => {
      await expect(section.passwordHeading).toBeVisible();
      await expect(section.passwordCard).toBeVisible();
      await expect(section.currentPasswordField).toBeVisible();
      await expect(section.newPasswordField).toBeVisible();
      await expect(section.changePasswordButton).toBeVisible();
      await expect(section.sessionsCard).toBeVisible();
      await expect(settingsPage.apiTokens.card).toBeVisible();
    });
  });

  // The admin's sessions are shared by every spec, so the list is stubbed.
  test("ask before revoking another session", async ({ settingsPage }) => {
    const section = settingsPage.account;

    await test.step("open the security section with another session listed", async () => {
      await section.stubSessions("Kobo Libra");
      await settingsPage.goto("security");
    });

    const revokes = section.recordSessionRevokes();

    await test.step("ask to revoke it and back out", async () => {
      await section.startRevokeSession("Kobo Libra");
      await expect(section.sessionRevokeDialog).toBeVisible();
      await section.cancelSessionRevoke();
    });

    await test.step("check the dialog closed and nothing was sent", async () => {
      await expect(section.sessionRevokeDialog).toHaveCount(0);
      expect(revokes).toEqual([]);
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

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
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

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
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

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
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
      await settingsPage.goto("profile");
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

    await test.step("open the profile section", async () => {
      await settingsPage.goto("profile");
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

  test("offer save display name only once the name changes", async ({
    settingsPage,
  }) => {
    const section = settingsPage.account;

    await test.step("open the profile section", async () => {
      await settingsPage.goto("profile");
    });

    const original = await section.displayNameField.inputValue();

    await test.step("check there is nothing to save yet", async () => {
      await expect(section.saveDisplayNameButton).toBeDisabled();
    });

    await test.step("change the name", async () => {
      await section.fillDisplayName(`${original} draft`);
      await expect(section.saveDisplayNameButton).toBeEnabled();
    });

    await test.step("type the original back", async () => {
      await section.fillDisplayName(original);
      await expect(section.saveDisplayNameButton).toBeDisabled();
    });
  });

  test("ask before leaving an unsaved display name", async ({
    settingsPage,
  }) => {
    const section = settingsPage.account;

    await test.step("edit the display name", async () => {
      await settingsPage.goto("profile");
      await section.fillDisplayName("Unsaved name");
    });

    await test.step("try to leave and keep editing", async () => {
      await settingsPage.openSection("preferences");
      await expect(settingsPage.unsavedPrompt).toBeVisible();
      await settingsPage.keepEditing();
    });

    await test.step("check the section and the edit stay", async () => {
      await settingsPage.assertDisplayedFor("profile");
      await expect(section.displayNameField).toHaveValue("Unsaved name");
    });

    await test.step("try to leave again and discard the edit", async () => {
      await settingsPage.openSection("preferences");
      await settingsPage.discardEdits();
      await settingsPage.assertDisplayedFor("preferences");
    });
  });

  test("stay on the open section when its own link is clicked over edits", async ({
    settingsPage,
  }) => {
    const section = settingsPage.account;

    await test.step("edit the display name", async () => {
      await settingsPage.goto("profile");
      await section.fillDisplayName("Unsaved name");
    });

    await test.step("click the open section's own link", async () => {
      await settingsPage.openSection("profile");
    });

    await test.step("check nothing asks and the edit stays", async () => {
      await expect(settingsPage.unsavedPrompt).toHaveCount(0);
      await expect(section.displayNameField).toHaveValue("Unsaved name");
    });
  });

  test("confirm a saved profile picture", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("open the profile section", async () => {
      await settingsPage.goto("profile");
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
      await settingsPage.goto("profile");
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
      await expect(section.profileStatus).toBeEmpty();
    });
  });

  test("show an error when the avatar upload fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("open the profile section", async () => {
      await settingsPage.goto("profile");
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

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ask before the back link drops unsaved goals", async ({
    settingsPage,
  }) => {
    const section = settingsPage.account;

    await test.step("edit a goal", async () => {
      await settingsPage.goto("goals");
      await section.fillGoal("pages", "42");
    });

    await test.step("follow the back link and keep editing", async () => {
      await settingsPage.openSectionList();
      await expect(settingsPage.unsavedPrompt).toBeVisible();
      await settingsPage.keepEditing();
    });

    await test.step("check the section and the edit stay", async () => {
      await settingsPage.assertDisplayedFor("goals");
      await expect(section.goalField("pages")).toHaveValue("42");
    });
  });

  test("go back from the default section without asking", async ({
    settingsPage,
  }) => {
    const section = settingsPage.account;

    await test.step("edit the display name", async () => {
      await settingsPage.goto("profile");
      await section.fillDisplayName("Unsaved name");
    });

    await test.step("follow the back link", async () => {
      await settingsPage.openSectionList();
    });

    await test.step("check the list shows and nothing asked", async () => {
      await settingsPage.assertDisplayedFor();
      await expect(settingsPage.unsavedPrompt).toHaveCount(0);
    });
  });
});

// The five goal tests reset the same three per-user rows, so they run one at a
// time; the rest of the account surface keeps its parallelism.
test.describe("reading goals", () => {
  test.describe.configure({ mode: "serial" });

  test("edit goals inline and save all", async ({
    settingsPage,
    presetGoals,
    expectMutation,
  }) => {
    const section = settingsPage.account;

    await test.step("start with no goals", async () => {
      await presetGoals();
      await settingsPage.goto("goals");
    });

    // Always a form: three empty fields and one Save all, which waits for a change.
    await test.step("check the form is empty with one control", async () => {
      await expect(section.goalsHeading).toBeVisible();
      for (const kind of ["books", "pages", "minutes"] as const) {
        await expect(section.goalField(kind)).toBeEnabled();
        await expect(section.goalField(kind)).toHaveValue("");
      }
      await expect(section.goalsCardButtons).toHaveCount(1);
      await expect(section.saveGoalsButton).toHaveText("Save all");
      await expect(section.saveGoalsButton).toBeDisabled();
    });

    await test.step("fill in the three goals", async () => {
      await section.fillGoal("books", "24");
      await section.fillGoal("pages", "30");
      await section.fillGoal("minutes", "45");
      await expect(section.saveGoalsButton).toBeEnabled();
    });

    // The annual and daily routes can't be batched, so one Save all fans out
    // into per-kind writes and reports what landed.
    await test.step("save all", async () => {
      await expectMutation(account.annualGoal(24), () => section.saveGoals());
    });

    await test.step("check the goals saved", async () => {
      await expect(section.goalsStatus).toHaveText("Goals saved.");
      await expect(section.saveGoalsButton).toBeDisabled();
    });

    // The card reads all three back off the server, which tells an optimistic
    // render apart from a real write.
    await test.step("check the goals survive a reload", async () => {
      await settingsPage.reload();
      await expect(section.goalField("books")).toHaveValue("24");
      await expect(section.goalField("pages")).toHaveValue("30");
      await expect(section.goalField("minutes")).toHaveValue("45");
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
      await settingsPage.goto("goals");
      await expect(section.goalField("pages")).toHaveValue("30");
    });

    // Blanking is how the form drops a goal: there is no Clear per row.
    await test.step("empty the pages field and save", async () => {
      await section.fillGoal("pages", "");
      await expectMutation(account.dailyGoal("pages"), () =>
        section.saveGoals(),
      );
      await expect(section.goalsStatus).toHaveText("Goals saved.");
    });

    // Only changed kinds are written, so another device's value can't be
    // clobbered by a no-op save.
    await test.step("check only the pages goal cleared", async () => {
      await settingsPage.reload();
      await expect(section.goalField("books")).toHaveValue("24");
      await expect(section.goalField("pages")).toHaveValue("");
    });
  });

  test("refuse an out-of-range target before it costs a round trip", async ({
    settingsPage,
    presetGoals,
  }) => {
    const section = settingsPage.account;

    await test.step("start with no goals", async () => {
      await presetGoals();
      await settingsPage.goto("goals");
    });

    // 1,500 is a legal day of pages and an impossible day of minutes.
    await test.step("save 1500 pages and 1500 minutes", async () => {
      await section.fillGoal("pages", "1500");
      await section.fillGoal("minutes", "1500");
      await section.saveGoals();
    });

    await test.step("check the minutes field is refused and nothing is written", async () => {
      await expect(section.goalError("minutes")).toContainText("1440");
      await expect(section.goalField("minutes")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(section.goalError("pages")).toHaveCount(0);
      await expect(section.goalsStatus).toContainText("Nothing saved");
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
      await settingsPage.goto("goals");
      await settingsPage.forceServerError(account.dailyGoal("pages", 30));
    });

    await test.step("save an annual and a pages goal", async () => {
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
      await expect(section.goalError("pages")).toBeVisible();
    });

    // The annual write landed; the failed kind keeps its draft to retry.
    await test.step("check the failed kind keeps its draft", async () => {
      await expect(section.goalField("books")).toHaveValue("24");
      await expect(section.goalField("pages")).toHaveValue("30");
      await expect(section.saveGoalsButton).toBeEnabled();
    });
  });

  test("ask before leaving unsaved goals", async ({
    settingsPage,
    presetGoals,
  }) => {
    const section = settingsPage.account;

    await test.step("start with an annual goal", async () => {
      await presetGoals({ books: 24 });
      await settingsPage.goto("goals");
      await expect(section.goalField("books")).toHaveValue("24");
    });

    await test.step("edit it, try to leave and keep editing", async () => {
      await section.fillGoal("books", "99");
      await settingsPage.openSection("profile");
      await expect(settingsPage.unsavedPrompt).toBeVisible();
      await settingsPage.keepEditing();
      await expect(section.goalField("books")).toHaveValue("99");
    });

    // Typing the saved value back leaves nothing to lose.
    await test.step("type the saved value back and leave", async () => {
      await section.fillGoal("books", "24");
      await expect(section.saveGoalsButton).toBeDisabled();
      await settingsPage.openSection("profile");
      await settingsPage.assertDisplayedFor("profile");
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
      await settingsPage.goto("preferences");
      await expect(section.shareStatsSwitch).toBeChecked();
      await expect(section.shareStatsRow).toContainText("On by default.");
    });

    await test.step("flip the switch", async () => {
      await expectMutation(account.shareStats(false), () =>
        section.toggleShareStats(),
      );
      await expect(section.shareStatsSwitch).not.toBeChecked();
      await expect(section.shareStatsStatus).toHaveText("Saved");
    });

    await test.step("check it survives a reload", async () => {
      await settingsPage.reload();
      await expect(section.shareStatsSwitch).not.toBeChecked();
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
      await settingsPage.goto("preferences");
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
      await expect(section.shareStatsStatus).toHaveText(
        "Couldn’t save. Try again.",
      );
      await expect(section.shareStatsStatus).toHaveClass(/error/);
    });
  });
});
