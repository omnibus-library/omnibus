import { auth } from "../contracts/auth";
import type { Credentials } from "../data/users";
import { expect, test } from "../fixtures/pageFixtures";
import { TEST_PASSWORD, TEST_USERNAME } from "../utils/auth";

// These specs test the login flow itself, so they start without the shared
// session cookie that globalSetup wrote.
test.use({ storageState: { cookies: [], origins: [] } });

const admin: Credentials = { username: TEST_USERNAME, password: TEST_PASSWORD };

test.describe("login page", () => {
  test("show the login page layout", async ({ loginPage }) => {
    await test.step("open the login page", async () => {
      await loginPage.stubRegistrationOpen(true);
      await loginPage.goto();
    });

    await test.step("check the form", async () => {
      await loginPage.assertDisplayed();
      await expect(loginPage.welcomeHeading).toBeVisible();
      await expect(loginPage.usernameField).toBeVisible();
      await expect(loginPage.passwordField).toBeVisible();
      await expect(loginPage.keepSignedInCheckbox).toBeVisible();
      await expect(loginPage.logInButton).toBeVisible();
      await expect(loginPage.registerLink).toBeVisible();
    });
  });

  test("log in with the correct credentials", async ({
    loginPage,
    libraryPage,
    expectMutation,
  }) => {
    await test.step("open the login page", async () => {
      await loginPage.goto();
    });

    await test.step("log in", async () => {
      await expectMutation(auth.login(), () => loginPage.logIn(admin));
    });

    await test.step("check the library opens", async () => {
      await libraryPage.assertDisplayed();
    });
  });

  test("log in by pressing enter in the password field", async ({
    loginPage,
    libraryPage,
    expectMutation,
  }) => {
    await test.step("fill in the credentials", async () => {
      await loginPage.goto();
      await loginPage.fillCredentials(admin);
    });

    await test.step("press enter", async () => {
      await expectMutation(auth.login(), () => loginPage.submitWithEnter());
    });

    await test.step("check the library opens", async () => {
      await libraryPage.assertDisplayed();
    });
  });

  test("show an error when the credentials are wrong", async ({
    loginPage,
    expectMutation,
  }) => {
    await test.step("open the login page", async () => {
      await loginPage.goto();
    });

    await test.step("log in with the wrong password", async () => {
      await expectMutation(auth.login(401), () =>
        loginPage.logIn({ ...admin, password: "definitely-not-the-password" }),
      );
    });

    // The banner must name the failure, never the wire status (#2468).
    await test.step("check the banner names the failure", async () => {
      await expect(loginPage.errorBanner).toContainText(
        /username or password/i,
      );
      await expect(loginPage.errorBanner).not.toContainText("401");
      await loginPage.assertRedirectedHere();
    });
  });

  test("show an error when the form is empty", async ({ loginPage }) => {
    await test.step("open the login page", async () => {
      await loginPage.goto();
    });

    // The client rejects the form before sending anything.
    await test.step("submit nothing", async () => {
      await loginPage.submit();
    });

    await test.step("check the banner asks for both fields", async () => {
      await expect(loginPage.errorBanner).toContainText(
        /username and password/i,
      );
    });
  });

  // The Forgot? link sits beside the Password label and must not take the Tab,
  // or "name Tab password Enter" would land on the link instead of submitting.
  test("tab from the username field to the password field", async ({
    loginPage,
  }) => {
    await test.step("open the login page", async () => {
      await loginPage.goto();
    });

    await test.step("press tab in the username field", async () => {
      await loginPage.tabFromUsername();
    });

    await test.step("check the password field has focus", async () => {
      await expect(loginPage.passwordField).toBeFocused();
    });
  });

  test("hide the register link when signup is off", async ({ loginPage }) => {
    await test.step("open the login page with signup off", async () => {
      await loginPage.stubRegistrationOpen(false);
      await loginPage.goto();
    });

    await test.step("check the form stays and the link goes", async () => {
      await expect(loginPage.logInButton).toBeVisible();
      await expect(loginPage.registerLink).toHaveCount(0);
    });
  });

  test("offer the register link when signup is on", async ({ loginPage }) => {
    await test.step("open the login page with signup on", async () => {
      await loginPage.stubRegistrationOpen(true);
      await loginPage.goto();
    });

    await test.step("check the link shows", async () => {
      await expect(loginPage.registerLink).toBeVisible();
    });
  });
});

test.describe("signed-out visits", () => {
  // The server answers the page load itself (#2632): no app shell renders
  // around a library the reader can no longer fetch.
  test("send a visit to the library to the login page", async ({
    loginPage,
  }) => {
    await test.step("open the library signed out", async () => {
      await loginPage.visitSignedOut("/");
    });

    await test.step("check the login page shows", async () => {
      await loginPage.assertRedirectedHere();
      await expect(loginPage.welcomeHeading).toBeVisible();
    });
  });

  // Not /stats: a visit there as the shared user would fill the server's 60s
  // stats cache before `stats.spec.ts` seeds its sessions.
  test("return to a deep link after logging in", async ({
    loginPage,
    authorsIndexPage,
    adminSession,
    expectMutation,
  }) => {
    await test.step("open the authors index signed out", async () => {
      await loginPage.visitSignedOut("/authors");
      await loginPage.assertRedirectedHere("/authors");
    });

    // The return trip is what's under test, so the login spends none of the
    // per-IP budget the whole suite shares.
    await test.step("log in", async () => {
      await loginPage.stubSignIn(adminSession);
      await expectMutation(auth.login(), () => loginPage.logIn(admin));
    });

    await test.step("check the authors index opens", async () => {
      await authorsIndexPage.assertDisplayed();
    });
  });
});

test.describe("register page", () => {
  test("show the register page layout", async ({ registerPage }) => {
    await test.step("open the register page", async () => {
      await registerPage.stubRegistrationOpen(true);
      await registerPage.goto();
    });

    await test.step("check the form", async () => {
      await registerPage.assertDisplayed();
      await expect(registerPage.usernameField).toBeVisible();
      await expect(registerPage.passwordField).toBeVisible();
      await expect(registerPage.strengthMeter).toBeVisible();
      await expect(registerPage.passwordHint).toBeVisible();
      await expect(registerPage.createAccountButton).toBeVisible();
      await expect(registerPage.logInLink).toBeVisible();
    });
  });

  test("route a password error to the password field", async ({
    registerPage,
    expectMutation,
  }) => {
    await test.step("open the register page", async () => {
      await registerPage.stubRegistrationOpen(true);
      await registerPage.goto();
      await registerPage.stubShortPasswordRejection();
    });

    await test.step("register with a short password", async () => {
      await expectMutation(auth.register(400), () =>
        registerPage.register({ username: "new-user", password: "short" }),
      );
    });

    // The message belongs inside the password field, not the top-level banner,
    // which would carry role=alert too.
    await test.step("check the error sits on the password field", async () => {
      await expect(registerPage.passwordField).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(registerPage.usernameField).toHaveAttribute(
        "aria-invalid",
        "false",
      );
      await expect(registerPage.passwordFieldError).toContainText(
        "password is too short",
      );
      await expect(registerPage.fixToContinueButton).toBeDisabled();
    });
  });

  test("show a closed notice instead of the form when signup is off", async ({
    registerPage,
  }) => {
    await test.step("open the register page with signup off", async () => {
      await registerPage.stubRegistrationOpen(false);
      await registerPage.goto();
    });

    // The form is absent rather than disabled, so nobody fills in credentials
    // the server will refuse.
    await test.step("check the notice replaces the form", async () => {
      await expect(registerPage.closedNotice).toBeVisible();
      await expect(registerPage.closedMessage).toBeVisible();
      await expect(registerPage.form).toHaveCount(0);
      await expect(registerPage.createAccountButton).toHaveCount(0);
      await expect(registerPage.logInLink).toBeVisible();
    });
  });
});
