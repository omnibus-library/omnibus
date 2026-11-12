import { notifications } from "../contracts/notifications";
import {
  buildNtfyConnection,
  CLOSED_NTFY_SERVER_TEST_FAILED,
  type NotificationConnection,
  savedWithoutSecrets,
  topicAddress,
} from "../data/notifications";
import { expect, test } from "../fixtures/pageFixtures";

test.describe("notifications section", () => {
  test("show the notifications layout", async ({ adminPage }) => {
    const { notifications: section } = adminPage;

    await test.step("open the notifications section", async () => {
      await adminPage.goto("notifications");
    });

    await test.step("check the page, its nav and both cards", async () => {
      await adminPage.assertDisplayedFor("notifications");
      await adminPage.topNav.assertDisplayed();
      await expect(adminPage.sectionLink("notifications")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(section.publicUrlField).toBeEditable();
      await expect(section.savePublicUrlButton).toBeEnabled();
      await expect(section.addButton).toBeVisible();
    });
  });

  test("save a public URL, then clear it", async ({
    adminPage,
    scratchPublicUrl,
    expectMutation,
  }) => {
    const { notifications: section } = adminPage;

    await test.step("open the notifications section", async () => {
      await adminPage.goto("notifications");
    });

    await test.step("save the public URL", async () => {
      await section.fillPublicUrl(`${scratchPublicUrl}/`);
      await expectMutation(
        notifications.savePublicUrl(`${scratchPublicUrl}/`),
        () => section.savePublicUrl(),
      );
      await expect(section.publicUrlSaveStatus).toHaveText("Public URL saved.");
      await expect(section.publicUrlSource).toHaveText("Saved here");
      await expect(section.publicUrlField).toHaveValue(scratchPublicUrl);
    });

    await test.step("reload and find it still saved", async () => {
      await adminPage.reload();
      await expect(section.publicUrlField).toHaveValue(scratchPublicUrl);
      await expect(section.publicUrlSource).toHaveText("Saved here");
    });

    await test.step("clear the saved URL", async () => {
      await expectMutation(notifications.savePublicUrl(null), () =>
        section.clearPublicUrl(),
      );
      await expect(section.publicUrlField).toHaveValue("");
    });

    await test.step("reload and find nothing saved here", async () => {
      await adminPage.reload();
      await expect(section.publicUrlField).toHaveValue("");
      // A server started with OMNIBUS_PUBLIC_URL falls back to it; one without has none.
      await expect(section.publicUrlSource).toHaveText(
        /^(Not set|Set by the server’s environment \(OMNIBUS_PUBLIC_URL\))$/,
      );
      await expect(section.clearPublicUrlButton).toHaveCount(0);
    });
  });

  test("refuse a public URL that is not http", async ({
    adminPage,
    expectMutation,
  }) => {
    const { notifications: section } = adminPage;
    const refused = "ftp://books.example.test";

    await test.step("open the notifications section", async () => {
      await adminPage.goto("notifications");
    });

    await test.step("save an ftp address", async () => {
      await section.fillPublicUrl(refused);
      await expectMutation(notifications.savePublicUrl(refused, 422), () =>
        section.savePublicUrl(),
      );
    });

    await test.step("check the reason shows by the field, which keeps it", async () => {
      await expect(section.publicUrlError).toHaveText(
        "The public URL must start with http:// or https://",
      );
      await expect(section.publicUrlField).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(section.publicUrlField).toHaveValue(refused);
    });
  });

  test("add an ntfy connection", async ({
    adminPage,
    expectMutation,
    createdNotificationIds,
    offeredNotificationEvents,
  }) => {
    const { notifications: section } = adminPage;
    const { modal } = section;
    const input = buildNtfyConnection({ events: offeredNotificationEvents });
    const { settings } = input;

    await test.step("open the add form", async () => {
      await adminPage.goto("notifications");
      await section.startAdding();
      await expect(modal.dialog).toBeVisible();
    });

    await test.step("fill in and save the connection", async () => {
      await modal.fillTokenConnection({
        name: input.name,
        serverUrl: settings.server_url,
        topic: settings.topic,
        token: settings.token ?? "",
      });
      const { request, response } = await expectMutation(
        notifications.create(),
        () => modal.save(),
      );
      // Registered before any check, so a failed one still deletes it.
      const created: NotificationConnection = await response.json();
      createdNotificationIds.add(created.id);
      expect(request.postDataJSON()).toEqual(input);
      expect(created.settings.token_set).toBe(true);
    });

    await test.step("check the list shows it, with nothing delivered yet", async () => {
      await expect(modal.dialog).toBeHidden();
      await expect(section.row(input.name)).toContainText(
        topicAddress(settings),
      );
      await expect(section.rowLastDelivery(input.name)).toHaveText(
        "No deliveries yet",
      );
      await expect(section.rowSwitch(input.name)).toBeChecked();
    });
  });

  test("show why a test notification failed", async ({
    adminPage,
    expectMutation,
  }) => {
    const { notifications: section } = adminPage;
    const { modal } = section;
    const { settings } = buildNtfyConnection();

    await test.step("open the add form", async () => {
      await adminPage.goto("notifications");
      await section.startAdding();
    });

    await test.step("test a server nothing answers on", async () => {
      await modal.fillServer(settings.server_url, settings.topic);
      await expectMutation(notifications.test(502), () => modal.sendTest());
    });

    await test.step("check the error shows in the form, which stays open", async () => {
      await expect(modal.testStatus).toHaveText(CLOSED_NTFY_SERVER_TEST_FAILED);
      await expect(modal.dialog).toBeVisible();
      await expect(modal.topicField).toHaveValue(settings.topic);
    });
  });

  test("test a saved connection from its row", async ({
    adminPage,
    expectMutation,
    ntfyConnection,
  }) => {
    const { notifications: section } = adminPage;
    const connection = await ntfyConnection();

    await test.step("open the notifications section", async () => {
      await adminPage.goto("notifications");
    });

    await test.step("test the connection as saved", async () => {
      await expectMutation(notifications.test(502), () =>
        section.testRow(connection.name),
      );
    });

    await test.step("check its row says why the test failed", async () => {
      await expect(section.rowStatus(connection.name)).toHaveText(
        CLOSED_NTFY_SERVER_TEST_FAILED,
      );
      await expect(section.rowLastDelivery(connection.name)).toHaveText(
        "No deliveries yet",
      );
    });
  });

  test("edit a connection without retyping its token", async ({
    adminPage,
    expectMutation,
    ntfyConnection,
    storedNotificationConnection,
  }) => {
    const { notifications: section } = adminPage;
    const { modal } = section;
    const connection = await ntfyConnection();
    const renamed = `${connection.name} renamed`;

    await test.step("open the connection's edit form", async () => {
      await adminPage.goto("notifications");
      await section.edit(connection.name);
    });

    await test.step("check the saved token shows as set, not as its value", async () => {
      await expect(modal.tokenField).toHaveValue("");
      await expect(modal.savedTokenStatus).toHaveText("A token is saved");
    });

    await test.step("rename it and save, sending no token", async () => {
      await modal.rename(renamed);
      await expectMutation(
        notifications.update(
          savedWithoutSecrets(connection, { name: renamed }),
        ),
        () => modal.save(),
      );
      await expect(section.row(renamed)).toBeVisible();
    });

    await test.step("check the server kept the token", async () => {
      const stored = await storedNotificationConnection(connection.id);
      expect(stored?.name).toBe(renamed);
      expect(stored?.settings.token_set).toBe(true);
    });
  });

  test("turn a connection off", async ({
    adminPage,
    expectMutation,
    ntfyConnection,
    storedNotificationConnection,
  }) => {
    const { notifications: section } = adminPage;
    const connection = await ntfyConnection();

    await test.step("open the notifications section", async () => {
      await adminPage.goto("notifications");
      await expect(section.rowSwitch(connection.name)).toBeChecked();
    });

    await test.step("flip its switch off", async () => {
      await expectMutation(notifications.setEnabled(false), () =>
        section.flip(connection.name),
      );
      await expect(section.rowSwitch(connection.name)).not.toBeChecked();
    });

    await test.step("check the server has it off, token kept", async () => {
      const stored = await storedNotificationConnection(connection.id);
      expect(stored?.enabled).toBe(false);
      expect(stored?.settings.token_set).toBe(true);
    });
  });

  test("delete a connection", async ({
    adminPage,
    expectMutation,
    ntfyConnection,
    createdNotificationIds,
    storedNotificationConnection,
  }) => {
    const { notifications: section } = adminPage;
    const connection = await ntfyConnection();

    await test.step("ask to delete it", async () => {
      await adminPage.goto("notifications");
      await section.startDeleting(connection.name);
      await expect(section.deleteDialog).toBeVisible();
    });

    await test.step("confirm the delete", async () => {
      await expectMutation(notifications.delete(), () =>
        section.confirmDelete(),
      );
      createdNotificationIds.delete(connection.id);
    });

    await test.step("check it left the list and the server", async () => {
      await expect(section.row(connection.name)).toHaveCount(0);
      await expect(section.status).toHaveText(`${connection.name} deleted.`);
      expect(await storedNotificationConnection(connection.id)).toBeUndefined();
    });
  });
});
