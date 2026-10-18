import { users } from "../contracts/users";
import { buildReader, buildUploader } from "../data/users";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { TEST_USERNAME } from "../utils/auth";

// The last-admin and non-admin guards live in the server's integration tests,
// since here they would mutate the suite's admin.

test.describe("users section", () => {
  test("show the users section layout", async ({ settingsPage }) => {
    const { users: section } = settingsPage;

    await test.step("open the users section", async () => {
      await settingsPage.goto("users");
    });

    await test.step("check the table and its new-user button show", async () => {
      await expect(section.heading).toBeVisible();
      await expect(section.table).toBeVisible();
      await expect(section.newUserButton).toBeVisible();
      // The suite's admin is always present.
      await expect(section.row(TEST_USERNAME)).toBeVisible();
      await settingsPage.topNav.assertDisplayed();
    });
  });

  test("lock the other permissions when administrator is checked", async ({
    settingsPage,
  }) => {
    const { users: section } = settingsPage;

    await test.step("open the new-user form", async () => {
      await settingsPage.goto("users");
      await section.openNewUserForm();
      await expect(section.permission("can_upload")).not.toBeChecked();
    });

    await test.step("make the user an administrator", async () => {
      await section.checkPermission("is_admin");
    });

    await test.step("check the other permissions are on and locked", async () => {
      await expect(section.permission("can_upload")).toBeChecked();
      await expect(section.permission("can_edit")).toBeChecked();
      await expect(section.permission("can_upload")).toBeDisabled();
      await expect(section.permission("can_edit")).toBeDisabled();
    });
  });

  test("create a user", async ({
    settingsPage,
    createdUserIds,
    expectMutation,
  }) => {
    const { users: section } = settingsPage;
    const user = buildUploader();

    await test.step("open the new-user form", async () => {
      await settingsPage.goto("users");
      await section.openNewUserForm();
    });

    await test.step("fill in the user and let it upload", async () => {
      await section.fillCredentials(user);
      await section.checkPermission("can_upload");
    });

    await test.step("submit the form", async () => {
      const { response } = await expectMutation(users.create(user), () =>
        section.submitNewUser(),
      );
      const { id } = await response.json();
      createdUserIds.add(id);
    });

    await test.step("check the table lists the user", async () => {
      await expect(section.row(user.username)).toBeVisible();
      await expect(
        section.permissionChip(user.username, "Upload"),
      ).toBeVisible();
    });
  });

  test("delete a user", async ({
    settingsPage,
    seedUser,
    createdUserIds,
    expectMutation,
  }) => {
    const { users: section } = settingsPage;
    const user = await seedUser();

    await test.step("ask to delete the user", async () => {
      await settingsPage.goto("users");
      await section.openDeleteDialog(user.username);
      await expect(section.deleteDialog).toBeVisible();
    });

    await test.step("confirm the delete", async () => {
      await expectMutation(users.delete(), () => section.confirmDelete());
      createdUserIds.delete(user.id);
    });

    await test.step("check the table no longer lists the user", async () => {
      await expect(section.row(user.username)).toHaveCount(0);
    });
  });

  // The dialog's backdrop had no busy gate, so a stray click mid-delete closed
  // it before the admin saw the outcome (#1484).
  test("ignore a backdrop click while a delete is in flight", async ({
    settingsPage,
    seedUser,
    createdUserIds,
    expectMutation,
  }) => {
    const { users: section } = settingsPage;
    const user = await seedUser();

    await test.step("ask to delete the user", async () => {
      await settingsPage.goto("users");
      await expect(section.row(user.username)).toBeVisible();
      await section.openDeleteDialog(user.username);
      await expect(section.deleteDialog).toBeVisible();
    });

    await test.step("click the backdrop while the delete is in flight", async () => {
      await section.stubSlowDeletes(400);
      await expectMutation(users.delete(), async () => {
        await section.confirmDelete();
        await section.clickDeleteBackdrop();
        await expect(section.deleteDialog).toBeVisible();
      });
      createdUserIds.delete(user.id);
    });

    await test.step("check the dialog closed with the user gone", async () => {
      await expect(section.deleteDialog).toHaveCount(0);
      await expect(section.row(user.username)).toHaveCount(0);
    });
  });

  test("reject a duplicate username", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { users: section } = settingsPage;

    await test.step("open the new-user form", async () => {
      await settingsPage.goto("users");
      await section.openNewUserForm();
    });

    // The server rejects the suite's admin's name before any write.
    await test.step("submit the admin's username", async () => {
      await section.fillCredentials({
        ...buildReader(),
        username: TEST_USERNAME,
      });
      await expectMutation(users.createConflict(), () =>
        section.submitNewUser(),
      );
    });

    await test.step("check the form reports the clash", async () => {
      await expect(section.formError).toContainText(
        "username is already taken",
      );
    });
  });
});

// `registration_enabled` is one row auth.spec's pages read, and readers take no
// lock, so these stub its read and write; the server tests cover persistence.
test.describe("self-registration", () => {
  test("show the current self-registration setting", async ({
    settingsPage,
  }) => {
    const { users: section } = settingsPage;

    await test.step("open the users section with sign-up closed", async () => {
      await section.stubRegistrationOpen(false);
      await settingsPage.goto("users");
    });

    await test.step("check the switch is off and enabled", async () => {
      await expect(section.registrationSwitch).not.toBeChecked();
      await expect(section.registrationCard).toContainText(
        "Only an administrator can create accounts.",
      );
      await expect(section.registrationSwitch).toBeEnabled();
    });
  });

  test("turn self-registration on", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { users: section } = settingsPage;

    await test.step("open the users section with sign-up closed", async () => {
      await section.stubRegistrationOpen(false);
      await section.stubRegistrationSaved();
      await settingsPage.goto("users");
      await expect(section.registrationSwitch).not.toBeChecked();
    });

    await test.step("turn sign-up on", async () => {
      await expectMutation(users.setRegistration(true), () =>
        section.allowRegistration(),
      );
    });

    await test.step("check the card says anyone can register", async () => {
      await expect(section.registrationSwitch).toBeChecked();
      await expect(section.registrationCard).toContainText(
        "Anyone who can reach this server can create an account.",
      );
      await expect(section.registrationError).toHaveCount(0);
    });
  });

  test("show an error and keep the switch when saving fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { users: section } = settingsPage;
    const turnOff = users.setRegistration(false);

    await test.step("open the users section with sign-up open", async () => {
      await section.stubRegistrationOpen(true);
      await settingsPage.forceServerError(turnOff);
      await settingsPage.goto("users");
      await expect(section.registrationSwitch).toBeChecked();
    });

    await test.step("turn sign-up off", async () => {
      await expectMutation(failing(turnOff), () => section.blockRegistration());
    });

    await test.step("check the error shows and the switch stays on", async () => {
      await expect(section.registrationError).toContainText("forced failure");
      // The switch must not claim a state the server rejected.
      await expect(section.registrationSwitch).toBeChecked();
      await expect(section.registrationCard).toContainText(
        "Anyone who can reach this server can create an account.",
      );
    });
  });
});
