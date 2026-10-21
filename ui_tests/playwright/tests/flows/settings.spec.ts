import { settings } from "../contracts/settings";
import { buildMetadataKey } from "../data/metadataKeys";
import type { LibrarySettings, SmtpSettings } from "../data/settings";
import { expect, test } from "../fixtures/pageFixtures";
import type { AdminSection } from "../pages/AdminPage";
import type { SettingsSection } from "../pages/SettingsPage";
import { failing } from "../utils/api";

// Settings holds each reader's own sections and Administration the server's;
// the suite's admin sees both.
const PERSONAL_SECTIONS: SettingsSection[] = [
  "profile",
  "preferences",
  "goals",
  "devices",
  "security",
];

const ADMIN_SECTIONS: AdminSection[] = [
  "sources",
  "maintenance",
  "metadata",
  "cleanup",
  "people",
  "integrations",
  "health",
  "logs",
];

const placeholderLibrary: LibrarySettings = {
  ebook_library_path: "/tmp/whatever",
  audiobook_library_path: "/tmp/whatever-audio",
};

const smtp: SmtpSettings = {
  host: "smtp.example.com",
  fromEmail: "library@example.com",
  password: "s3cret-pass",
};

const KEY_PROVIDERS = [
  { provider: "hardcover", name: "Hardcover" },
  { provider: "google-books", name: "Google Books" },
] as const;

test.describe("settings page", () => {
  test("show the settings layout", async ({ settingsPage }) => {
    await test.step("open settings", async () => {
      await settingsPage.goto();
    });

    await test.step("check the sidebar lists the personal sections", async () => {
      await settingsPage.assertDisplayed();
      await expect(settingsPage.heading).toBeVisible();
      for (const section of PERSONAL_SECTIONS) {
        await expect(settingsPage.sectionLink(section)).toBeVisible();
      }
      // An admin also gets the way into Administration.
      await expect(settingsPage.adminLink).toBeVisible();
      await settingsPage.topNav.assertDisplayed();
    });
  });
});

test.describe("administration page", () => {
  test("show the administration layout", async ({ adminPage }) => {
    await test.step("open administration", async () => {
      await adminPage.goto();
    });

    await test.step("check the sidebar lists every admin section", async () => {
      await adminPage.assertDisplayed();
      await expect(adminPage.heading).toBeVisible();
      for (const section of ADMIN_SECTIONS) {
        await expect(adminPage.sectionLink(section)).toBeVisible();
      }
      await expect(adminPage.sectionLink("sources")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(adminPage.settingsLink).toBeVisible();
      await adminPage.topNav.assertDisplayed();
    });
  });

  test("refuse administration to a reader who is not an admin", async ({
    readerAdminPage,
  }) => {
    await test.step("open the people section as the reader", async () => {
      await readerAdminPage.goto("people");
    });

    await test.step("check the refusal shows and the section does not", async () => {
      await expect(readerAdminPage.forbiddenNotice).toBeVisible();
      await expect(readerAdminPage.users.card).toHaveCount(0);
    });
  });

  test("open each section from the sidebar", async ({ adminPage }) => {
    await test.step("open administration", async () => {
      await adminPage.goto();
    });

    await test.step("open integrations", async () => {
      await adminPage.openSection("integrations");
      await adminPage.assertDisplayedFor("integrations");
      const { integrations } = adminPage;
      await expect(integrations.smtp.card).toBeVisible();
      await expect(integrations.keyCard("hardcover").root).toBeVisible();
      await expect(integrations.keyCard("google-books").root).toBeVisible();
    });

    await test.step("open people", async () => {
      await adminPage.openSection("people");
      await adminPage.assertDisplayedFor("people");
      await expect(adminPage.users.card).toBeVisible();
    });

    await test.step("open health", async () => {
      await adminPage.openSection("health");
      await adminPage.assertDisplayedFor("health");
      await expect(adminPage.health.root).toBeVisible();
    });

    await test.step("open maintenance", async () => {
      await adminPage.openSection("maintenance");
      await adminPage.assertDisplayedFor("maintenance");
      await expect(adminPage.maintenance.card).toBeVisible();
      await expect(adminPage.maintenance.backgroundTasksCard).toBeVisible();
    });

    await test.step("open logs", async () => {
      await adminPage.openSection("logs");
      await adminPage.assertDisplayedFor("logs");
      await expect(adminPage.logs.root).toBeVisible();
    });
  });

  test("follow an old settings link to its new home", async ({ adminPage }) => {
    await test.step("open the old users address", async () => {
      await adminPage.gotoLegacy("/settings?section=users");
    });

    await test.step("check administration shows the people section", async () => {
      await adminPage.assertDisplayedFor("people");
    });
  });

  test("follow an old cleanup review link to its new home", async ({
    cleanupReviewPage,
  }) => {
    await test.step("open the old author review address", async () => {
      await cleanupReviewPage.gotoLegacy("/settings/cleanup/authors");
    });

    await test.step("check the review shows under administration", async () => {
      await cleanupReviewPage.assertDisplayedFor("authors");
    });
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("pick a settings section from the list", async ({ settingsPage }) => {
    await test.step("open settings", async () => {
      await settingsPage.goto();
    });

    await test.step("check only the list shows", async () => {
      await expect(settingsPage.sectionLink("devices")).toBeVisible();
      await expect(settingsPage.backLink).toBeHidden();
      expect(await settingsPage.scroll.scrollsSideways()).toBe(false);
    });

    await test.step("pick the devices section", async () => {
      await settingsPage.openSection("devices");
    });

    await test.step("check only the section shows", async () => {
      await settingsPage.assertDisplayedFor("devices");
      await expect(settingsPage.kindle.card).toBeVisible();
      await expect(settingsPage.sectionLink("devices")).toBeHidden();
      expect(await settingsPage.scroll.scrollsSideways()).toBe(false);
    });
  });

  test("go back from a settings section to the list", async ({
    settingsPage,
  }) => {
    await test.step("open the devices section", async () => {
      await settingsPage.goto("devices");
    });

    await test.step("follow the back link", async () => {
      await settingsPage.openSectionList();
    });

    await test.step("check the list shows again", async () => {
      await settingsPage.assertDisplayedFor();
      await expect(settingsPage.sectionLink("devices")).toBeVisible();
    });
  });

  test("pick an administration section from the list", async ({
    adminPage,
  }) => {
    await test.step("open administration", async () => {
      await adminPage.goto();
    });

    await test.step("pick the people section", async () => {
      await adminPage.openSection("people");
    });

    await test.step("check the section shows without a sideways scroll", async () => {
      await adminPage.assertDisplayedFor("people");
      await expect(adminPage.users.table).toBeVisible();
      expect(await adminPage.scroll.scrollsSideways()).toBe(false);
    });
  });
});

test.describe("sources section", () => {
  test("show the sources section layout", async ({ adminPage }) => {
    const { library, maintenance } = adminPage;

    await test.step("open the sources section", async () => {
      await adminPage.goto("sources");
    });

    await test.step("check the form shows without the maintenance jobs", async () => {
      await expect(adminPage.sectionLink("sources")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(library.ebookPathField).toBeVisible();
      await expect(library.audiobookPathField).toBeVisible();
      await expect(library.scanIntervalField).toBeVisible();
      await expect(library.saveButton).toBeEnabled();
      await expect(maintenance.scanButton).toHaveCount(0);
      await expect(library.status).toBeAttached();
      await expect(library.ebookSummary).toBeAttached();
      await expect(library.audiobookSummary).toBeAttached();
    });
  });

  // Blank fields saved over a failed read would clear both library paths.
  test("hold the library save when the saved settings fail to load", async ({
    adminPage,
  }) => {
    const { library } = adminPage;

    await test.step("open the sources section with the read failing", async () => {
      await adminPage.forceServerError(settings.load());
      await adminPage.goto("sources");
    });

    await test.step("check the save is held and a retry offered", async () => {
      await expect(library.saveButton).toBeDisabled();
      await expect(library.retryButton).toBeVisible();
      await expect(library.status).toHaveClass(/error/);
    });
  });

  test("save the library paths", async ({
    adminPage,
    expectMutation,
    scratchLibrary,
  }) => {
    const { library } = adminPage;

    await test.step("open the sources section", async () => {
      await adminPage.goto("sources");
    });

    await test.step("fill in the library paths", async () => {
      await library.fillForm(scratchLibrary);
    });

    await test.step("save the settings", async () => {
      await expectMutation(settings.saveLibrary(scratchLibrary), () =>
        library.save(),
      );
    });

    await test.step("check the form reports the save", async () => {
      await library.assertSaved();
    });
  });

  test("save an automatic rescan interval with the library paths", async ({
    adminPage,
    expectMutation,
    scratchLibrary,
  }) => {
    const { library } = adminPage;
    const withInterval = { ...scratchLibrary, scan_interval_hours: 24 };

    await test.step("open the sources section", async () => {
      await adminPage.goto("sources");
    });

    await test.step("fill in the paths and the interval", async () => {
      await library.fillForm(withInterval);
    });

    await test.step("save the settings", async () => {
      await expectMutation(settings.saveLibrary(withInterval), () =>
        library.save(),
      );
    });

    await test.step("check the form reports the save", async () => {
      await library.assertSaved();
    });
  });

  test("show an error when the server rejects an invalid rescan interval", async ({
    adminPage,
    expectMutation,
  }) => {
    const { library } = adminPage;
    const tooShort = { ...placeholderLibrary, scan_interval_hours: 1 };

    await test.step("open the sources section", async () => {
      await adminPage.goto("sources");
    });

    // Rejected server-side, so the form's own min check can't stop the request.
    await test.step("fill in an interval the server rejects", async () => {
      await library.stubIntervalRejected();
      await library.fillForm(tooShort);
    });

    await test.step("save the settings", async () => {
      await expectMutation(settings.saveLibrary(tooShort, 422), () =>
        library.save(),
      );
    });

    await test.step("check the form reports the failure", async () => {
      await library.assertSaveFailed();
    });
  });

  test("show an error when saving the library settings fails", async ({
    adminPage,
    expectMutation,
  }) => {
    const { library } = adminPage;
    const save = settings.saveLibrary(placeholderLibrary);

    await test.step("open the sources section", async () => {
      await adminPage.goto("sources");
    });

    await test.step("fill in the paths and fail the save", async () => {
      await library.fillForm(placeholderLibrary);
      await adminPage.forceServerError(save);
    });

    await test.step("save the settings", async () => {
      await expectMutation(failing(save), () => library.save());
    });

    await test.step("check the form reports the failure", async () => {
      await library.assertSaveFailed();
    });
  });

  test("ask before leaving unsaved library paths", async ({ adminPage }) => {
    const { library } = adminPage;

    await test.step("edit the ebook path", async () => {
      await adminPage.goto("sources");
      await expect(library.saveButton).toBeEnabled();
      await library.fillEbookPath("/srv/unsaved-path");
    });

    await test.step("try to leave and keep editing", async () => {
      await adminPage.openSection("people");
      await expect(adminPage.unsavedPrompt).toBeVisible();
      await adminPage.keepEditing();
    });

    await test.step("check the section and the edit stay", async () => {
      await adminPage.assertDisplayedFor("sources");
      await expect(library.ebookPathField).toHaveValue("/srv/unsaved-path");
    });
  });
});

test.describe("maintenance section", () => {
  test("show an error when a library scan fails", async ({
    adminPage,
    expectMutation,
  }) => {
    const { maintenance } = adminPage;
    const scan = settings.scanLibrary();

    await test.step("open the maintenance section", async () => {
      await adminPage.goto("maintenance");
      await adminPage.forceServerError(scan);
    });

    await test.step("start a scan", async () => {
      await expectMutation(failing(scan), () => maintenance.startScan());
    });

    await test.step("check the section reports the failure", async () => {
      await expect(maintenance.status).toContainText(
        "Failed to start library scan",
      );
      await expect(maintenance.status).toHaveClass(/error/);
    });
  });

  test("bake overrides into every epub", async ({
    adminPage,
    expectMutation,
  }) => {
    const { maintenance } = adminPage;

    await test.step("open the maintenance section", async () => {
      await adminPage.goto("maintenance");
      await maintenance.stubBakeQueued();
    });

    await test.step("bake the overrides", async () => {
      await expectMutation(settings.rewriteAllEpubs(), () =>
        maintenance.bakeEpubOverrides(),
      );
    });

    await test.step("check the section reports the bake as queued", async () => {
      await expect(maintenance.status).toHaveText("EPUB override bake queued.");
      await expect(maintenance.status).not.toHaveClass(/error/);
    });
  });

  test("show an error when the epub bake fails to queue", async ({
    adminPage,
    expectMutation,
  }) => {
    const { maintenance } = adminPage;
    const bake = settings.rewriteAllEpubs();

    await test.step("open the maintenance section", async () => {
      await adminPage.goto("maintenance");
      await adminPage.forceServerError(bake);
    });

    await test.step("bake the overrides", async () => {
      await expectMutation(failing(bake), () =>
        maintenance.bakeEpubOverrides(),
      );
    });

    await test.step("check the section reports the failure", async () => {
      await expect(maintenance.status).toContainText(
        "Failed to start EPUB override bake",
      );
      await expect(maintenance.status).toHaveClass(/error/);
    });
  });
});

test.describe("metadata section", () => {
  // The order is instance configuration other specs index under, so the write
  // is answered with the order it was sent.
  test("save only the metadata order that changed", async ({
    adminPage,
    expectMutation,
  }) => {
    const { metadata } = adminPage;

    await test.step("open the metadata section", async () => {
      await metadata.stubSaved();
      await adminPage.goto("metadata");
      await expect(metadata.item("ebook", 0)).toBeVisible();
      await expect(metadata.saveButton).toBeDisabled();
    });

    const saves = metadata.recordSaves();

    await test.step("move a provider down", async () => {
      await metadata.moveDown("ebook", 0);
      await expect(metadata.saveButton).toBeEnabled();
    });

    await test.step("save the order", async () => {
      const { request } = await expectMutation(
        settings.saveMetadataPrecedence(),
        () => metadata.save(),
      );
      expect(request.postDataJSON().library).toBe("ebook");
    });

    await test.step("check the order reads as saved once", async () => {
      await expect(metadata.status).toHaveText("Metadata order saved.");
      await expect(metadata.saveButton).toBeDisabled();
      expect(saves).toHaveLength(1);
    });
  });
});

test.describe("integrations section", () => {
  test("save the smtp config", async ({ adminPage, expectMutation }) => {
    const { smtp: card } = adminPage.integrations;

    await test.step("open the integrations section", async () => {
      await adminPage.goto("integrations");
    });

    // Stubbed, so no real relay is needed and the shared config stays as found.
    await test.step("fill in the relay", async () => {
      await card.stubSaved();
      await card.fillForm(smtp);
    });

    await test.step("save the config", async () => {
      await expectMutation(settings.saveSmtp(), () => card.save());
    });

    await test.step("check the card shows it configured", async () => {
      await expect(card.saveStatus).toHaveText("SMTP settings saved.");
      await expect(card.configuredStatus).toContainText("Configured");
    });
  });

  test("ask before clearing the smtp settings", async ({ adminPage }) => {
    const { smtp: card } = adminPage.integrations;

    await test.step("open the integrations section with a relay configured", async () => {
      await card.stubConfigured();
      await adminPage.goto("integrations");
    });

    const clears = card.recordClears();

    await test.step("ask to clear it and back out", async () => {
      await card.startClear();
      await expect(card.clearDialog).toBeVisible();
      await card.cancelClear();
    });

    await test.step("check the dialog closed and nothing was sent", async () => {
      await expect(card.clearDialog).toHaveCount(0);
      expect(clears).toEqual([]);
    });
  });

  test("ask before leaving a typed but unsaved key", async ({ adminPage }) => {
    const card = adminPage.integrations.keyCard("hardcover");

    await test.step("type a key without saving it", async () => {
      await adminPage.goto("integrations");
      await card.fillKey("hc_unsaved");
    });

    await test.step("try to leave and discard the key", async () => {
      await adminPage.openSection("people");
      await expect(adminPage.unsavedPrompt).toBeVisible();
      await adminPage.discardEdits();
    });

    await test.step("check the other section opened", async () => {
      await adminPage.assertDisplayedFor("people");
    });
  });
});

for (const { provider, name } of KEY_PROVIDERS) {
  const label = name.toLowerCase();

  test.describe(`${label} key`, () => {
    // Save and clear share one server-wide key, so they run in order.
    test.describe.configure({ mode: "default" });

    test(`save a ${label} key`, async ({
      adminPage,
      savedMetadataKeys,
      expectMutation,
    }) => {
      const card = adminPage.integrations.keyCard(provider);
      const key = buildMetadataKey(provider);

      await test.step("open the integrations section", async () => {
        await adminPage.goto("integrations");
      });

      await test.step("save a key", async () => {
        await card.fillKey(key);
        await expectMutation(settings.saveMetadataKey(provider, key), () =>
          card.save(),
        );
        savedMetadataKeys.add(provider);
      });

      await test.step("check the card shows it connected", async () => {
        await expect(card.message).toHaveText(`${name} key saved.`);
        await expect(card.message).toHaveClass(/success/);
        await expect(card.connectionStatus).toContainText("Connected");
        // The raw key is never echoed back to the client.
        await expect(card.keyField).toHaveValue("");
        await expect(card.clearButton).toBeVisible();
      });
    });

    test(`clear a ${label} key`, async ({
      adminPage,
      metadataKeysRequests,
      savedMetadataKeys,
      expectMutation,
    }) => {
      const card = adminPage.integrations.keyCard(provider);

      await test.step("save a key through the api", async () => {
        const saved = await metadataKeysRequests.postKey(
          provider,
          buildMetadataKey(provider),
        );
        await expect(saved).toBeOK();
        savedMetadataKeys.add(provider);
      });

      await test.step("open the integrations section", async () => {
        await adminPage.goto("integrations");
        await expect(card.clearButton).toBeVisible();
      });

      // Clearing asks first, since the key can't be read back to restore it.
      await test.step("clear the key", async () => {
        await expectMutation(settings.saveMetadataKey(provider, null), () =>
          card.clear(),
        );
        savedMetadataKeys.delete(provider);
      });

      await test.step("check the card shows it not connected", async () => {
        await expect(card.message).toHaveText(`${name} key cleared.`);
        await expect(card.message).toHaveClass(/success/);
        await expect(card.connectionStatus).toContainText("Not connected");
        await expect(card.clearButton).toHaveCount(0);
      });
    });

    test(`show an error when saving the ${label} key fails`, async ({
      adminPage,
      expectMutation,
    }) => {
      const card = adminPage.integrations.keyCard(provider);
      const key = buildMetadataKey(provider);
      const save = settings.saveMetadataKey(provider, key);

      await test.step("open the integrations section", async () => {
        await adminPage.goto("integrations");
      });

      await test.step("fill in a key and fail the save", async () => {
        await adminPage.forceServerError(save);
        await card.fillKey(key);
      });

      await test.step("save the key", async () => {
        await expectMutation(failing(save), () => card.save());
      });

      await test.step("check the card reports the failure", async () => {
        await expect(card.message).toContainText(
          `Couldn’t save the ${name} key`,
        );
        await expect(card.message).toHaveClass(/error/);
        // The failed save must not clear the admin's typed-in draft.
        await expect(card.keyField).toHaveValue(key);
      });
    });
  });
}
