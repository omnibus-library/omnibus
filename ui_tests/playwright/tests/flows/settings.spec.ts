import { settings } from "../contracts/settings";
import { buildMetadataKey } from "../data/metadataKeys";
import type { LibrarySettings, SmtpSettings } from "../data/settings";
import { expect, test } from "../fixtures/pageFixtures";
import type { SettingsSection } from "../pages/SettingsPage";
import { failing } from "../utils/api";

// The suite's admin sees the per-user sections and every server-config one.
const ADMIN_SECTIONS: SettingsSection[] = [
  "account",
  "kindle",
  "kobo",
  "api-tokens",
  "library",
  "metadata",
  "email",
  "logs",
];

const testLibrary: LibrarySettings = {
  ebook_library_path: "/tmp/omnibus-test-ebooks",
  audiobook_library_path: "/tmp/omnibus-test-audiobooks",
};

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

    await test.step("check the sidebar lists every admin section", async () => {
      await settingsPage.assertDisplayed();
      await expect(settingsPage.heading).toBeVisible();
      for (const section of ADMIN_SECTIONS) {
        await expect(settingsPage.sectionLink(section)).toBeVisible();
      }
      await settingsPage.topNav.assertDisplayed();
    });
  });

  test("open each section from the sidebar", async ({ settingsPage }) => {
    await test.step("open settings", async () => {
      await settingsPage.goto();
    });

    await test.step("open metadata lookup", async () => {
      await settingsPage.openSection("metadata");
      await settingsPage.assertSectionOpen("metadata");
      await expect(
        settingsPage.metadata.keyCard("hardcover").root,
      ).toBeVisible();
      await expect(
        settingsPage.metadata.keyCard("google-books").root,
      ).toBeVisible();
    });

    await test.step("open email delivery", async () => {
      await settingsPage.openSection("email");
      await settingsPage.assertSectionOpen("email");
      await expect(settingsPage.email.card).toBeVisible();
    });

    await test.step("open kindle", async () => {
      await settingsPage.openSection("kindle");
      await settingsPage.assertSectionOpen("kindle");
      await expect(settingsPage.kindleCard).toBeVisible();
    });

    await test.step("open kobo", async () => {
      await settingsPage.openSection("kobo");
      await settingsPage.assertSectionOpen("kobo");
      await expect(settingsPage.koboDevicesCard).toBeVisible();
    });
  });
});

test.describe("library section", () => {
  test("show the library section layout", async ({ settingsPage }) => {
    const { library } = settingsPage;

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
    });

    await test.step("check the form and its jobs show", async () => {
      await expect(settingsPage.sectionLink("library")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(library.ebookPathField).toBeVisible();
      await expect(library.audiobookPathField).toBeVisible();
      await expect(library.scanIntervalField).toBeVisible();
      await expect(library.saveButton).toBeVisible();
      await expect(library.scanButton).toBeVisible();
      await expect(library.bakeEpubOverridesButton).toBeVisible();
      await expect(library.status).toBeAttached();
      await expect(library.ebookSummary).toBeAttached();
      await expect(library.audiobookSummary).toBeAttached();
    });
  });

  test("save the library paths", async ({ settingsPage, expectMutation }) => {
    const { library } = settingsPage;

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
    });

    await test.step("fill in the library paths", async () => {
      await library.fillForm(testLibrary);
    });

    await test.step("save the settings", async () => {
      await expectMutation(settings.saveLibrary(testLibrary), () =>
        library.save(),
      );
    });

    await test.step("check the form reports the save", async () => {
      await library.assertSaved();
    });
  });

  test("save an automatic rescan interval with the library paths", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { library } = settingsPage;
    const withInterval = { ...testLibrary, scan_interval_hours: 24 };

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
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
    settingsPage,
    expectMutation,
  }) => {
    const { library } = settingsPage;
    const tooShort = { ...placeholderLibrary, scan_interval_hours: 1 };

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
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
    settingsPage,
    expectMutation,
  }) => {
    const { library } = settingsPage;
    const save = settings.saveLibrary(placeholderLibrary);

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
    });

    await test.step("fill in the paths and fail the save", async () => {
      await library.fillForm(placeholderLibrary);
      await settingsPage.forceServerError(save);
    });

    await test.step("save the settings", async () => {
      await expectMutation(failing(save), () => library.save());
    });

    await test.step("check the form reports the failure", async () => {
      await library.assertSaveFailed();
    });
  });

  test("show an error when a library scan fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { library } = settingsPage;
    const scan = settings.scanLibrary();

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
      await settingsPage.forceServerError(scan);
    });

    await test.step("start a scan", async () => {
      await expectMutation(failing(scan), () => library.startScan());
    });

    await test.step("check the form reports the failure", async () => {
      await expect(library.status).toContainText(
        "Failed to start library scan",
      );
      await expect(library.status).toHaveClass(/error/);
    });
  });

  test("bake overrides into every epub", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { library } = settingsPage;

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
      await library.stubBakeQueued();
    });

    await test.step("bake the overrides", async () => {
      await expectMutation(settings.rewriteAllEpubs(), () =>
        library.bakeEpubOverrides(),
      );
    });

    await test.step("check the form reports the bake as queued", async () => {
      await expect(library.status).toHaveText("EPUB override bake queued.");
      await expect(library.status).not.toHaveClass(/error/);
    });
  });

  test("show an error when the epub bake fails to queue", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { library } = settingsPage;
    const bake = settings.rewriteAllEpubs();

    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
      await settingsPage.forceServerError(bake);
    });

    await test.step("bake the overrides", async () => {
      await expectMutation(failing(bake), () => library.bakeEpubOverrides());
    });

    await test.step("check the form reports the failure", async () => {
      await expect(library.status).toContainText(
        "Failed to start EPUB override bake",
      );
      await expect(library.status).toHaveClass(/error/);
    });
  });
});

test.describe("email section", () => {
  test("save the smtp config", async ({ settingsPage, expectMutation }) => {
    const { email } = settingsPage;

    await test.step("open the email section", async () => {
      await settingsPage.goto("email");
    });

    // Stubbed, so no real relay is needed and the shared config stays as found.
    await test.step("fill in the relay", async () => {
      await email.stubSaved();
      await email.fillForm(smtp);
    });

    await test.step("save the config", async () => {
      await expectMutation(settings.saveSmtp(), () => email.save());
    });

    await test.step("check the card shows it configured", async () => {
      await expect(email.saveStatus).toHaveText("SMTP settings saved.");
      await expect(email.configuredStatus).toContainText("Configured");
    });
  });
});

for (const { provider, name } of KEY_PROVIDERS) {
  const label = name.toLowerCase();

  test.describe(`${label} key`, () => {
    // Save and clear share one server-wide key, so they run in order.
    test.describe.configure({ mode: "default" });

    test(`save a ${label} key`, async ({
      settingsPage,
      savedMetadataKeys,
      expectMutation,
    }) => {
      const card = settingsPage.metadata.keyCard(provider);
      const key = buildMetadataKey(provider);

      await test.step("open the metadata section", async () => {
        await settingsPage.goto("metadata");
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
      settingsPage,
      metadataKeysRequests,
      savedMetadataKeys,
      expectMutation,
    }) => {
      const card = settingsPage.metadata.keyCard(provider);

      await test.step("save a key through the api", async () => {
        const saved = await metadataKeysRequests.postKey(
          provider,
          buildMetadataKey(provider),
        );
        await expect(saved).toBeOK();
        savedMetadataKeys.add(provider);
      });

      await test.step("open the metadata section", async () => {
        await settingsPage.goto("metadata");
        await expect(card.clearButton).toBeVisible();
      });

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
      settingsPage,
      expectMutation,
    }) => {
      const card = settingsPage.metadata.keyCard(provider);
      const key = buildMetadataKey(provider);
      const save = settings.saveMetadataKey(provider, key);

      await test.step("open the metadata section", async () => {
        await settingsPage.goto("metadata");
      });

      await test.step("fill in a key and fail the save", async () => {
        await settingsPage.forceServerError(save);
        await card.fillKey(key);
      });

      await test.step("save the key", async () => {
        await expectMutation(failing(save), () => card.save());
      });

      await test.step("check the card reports the failure", async () => {
        await expect(card.message).toHaveText(`Failed to save ${name} key.`);
        await expect(card.message).toHaveClass(/error/);
        // The failed save must not clear the admin's typed-in draft.
        await expect(card.keyField).toHaveValue(key);
      });
    });
  });
}
