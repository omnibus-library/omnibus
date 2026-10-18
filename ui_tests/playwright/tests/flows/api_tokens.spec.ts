import { apiTokens } from "../contracts/apiTokens";
import { settings } from "../contracts/settings";
import type { CreatedApiToken } from "../data/account";
import { uniqueSuffix } from "../data/unique";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { topEdge } from "../utils/dom";

// Tokens are per-user state on the shared admin, so every test names its own
// uniquely and a fixture revokes what it made; counts are never asserted, only
// the presence or absence of a test's own rows.

test.describe("api tokens section", () => {
  test("show the api tokens layout", async ({ settingsPage }) => {
    const tokens = settingsPage.apiTokens;

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.assertDisplayedFor("security");
      await settingsPage.topNav.assertDisplayed();
    });

    // The head states the live-token count and the account's blast radius.
    await test.step("check the token card", async () => {
      await expect(tokens.card).toBeVisible();
      await expect(tokens.heading).toBeVisible();
      await expect(tokens.liveCount).toContainText("live");
      await expect(tokens.scope).toContainText("Admin");
      await expect(tokens.nameField).toBeVisible();
      await expect(tokens.createButton).toBeVisible();
    });

    // The secret only ever renders once, immediately after minting.
    await test.step("check no secret is shown", async () => {
      await expect(tokens.secretPanel).toHaveCount(0);
    });
  });

  test("create a token and hand off its secret once", async ({
    settingsPage,
    createdApiTokenIds,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e once ${uniqueSuffix()}`;

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
    });

    await test.step("create a token", async () => {
      const { response } = await expectMutation(apiTokens.create(name), () =>
        tokens.createToken(name),
      );
      const created: CreatedApiToken = await response.json();
      createdApiTokenIds.add(created.token.id);
    });

    // The panel holds the omni_ secret, its copy button and the `claude mcp add`
    // command carrying the same secret and this instance's origin.
    const secret =
      await test.step("check the secret is handed off", async () => {
        await expect(tokens.secretPanel).toBeVisible();
        const shown = await tokens.readSecret();
        expect(shown).toMatch(/^omni_/);
        await expect(tokens.secretCopyButton).toBeVisible();
        await expect(tokens.mcpCommand).toContainText(shown);
        await expect(tokens.mcpCommand).toContainText(tokens.instanceMcpUrl());
        await expect(tokens.mcpCommandCopyButton).toBeVisible();
        return shown;
      });

    // The form stays on top; the secret lands directly under it and the new
    // row joins the list below, rather than appearing above where it was made.
    await test.step("check the form, the secret and the row stack in order", async () => {
      await expect(tokens.nameField).toBeVisible();
      const formTop = await topEdge(tokens.createButton);
      const secretTop = await topEdge(tokens.secretPanel);
      expect(secretTop).toBeGreaterThan(formTop);
      expect(await topEdge(tokens.row(name))).toBeGreaterThan(secretTop);
    });

    await test.step("check the new row", async () => {
      await expect(tokens.row(name)).toBeVisible();
      await expect(tokens.rowIdentifier(name, secret)).toBeVisible();
      await expect(tokens.rowPill(name)).toHaveText("Never used");
    });

    await test.step("check the status line announces the hand-off", async () => {
      await expect(tokens.statusMessage).toContainText("Token created.");
    });

    await test.step("dismiss the secret", async () => {
      await tokens.dismissSecret();
      await expect(tokens.secretPanel).toHaveCount(0);
    });

    // The row persists and the secret does not: it is unrecoverable.
    await test.step("check the secret is gone after a reload", async () => {
      await settingsPage.reload();
      await expect(tokens.row(name)).toBeVisible();
      await expect(tokens.secretPanel).toHaveCount(0);
    });
  });

  test("revoke a token", async ({
    settingsPage,
    ownApiToken,
    createdApiTokenIds,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e revoke ${uniqueSuffix()}`;

    const id = await test.step("create a token through the api", () =>
      ownApiToken(name));

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
    });

    await test.step("ask to revoke it", async () => {
      await tokens.startRevoke(name);
      await expect(tokens.revokeConfirmRow).toBeVisible();
    });

    await test.step("confirm the revoke", async () => {
      await expectMutation(apiTokens.revoke(), () => tokens.confirmRevoke());
      createdApiTokenIds.delete(id);
      await expect(tokens.row(name)).toHaveCount(0);
    });
  });

  test("cancel an in-row revoke confirmation", async ({
    settingsPage,
    ownApiToken,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e cancel ${uniqueSuffix()}`;

    await test.step("create a token through the api", async () => {
      await ownApiToken(name);
    });

    await test.step("ask to revoke it", async () => {
      await settingsPage.goto("security");
      await tokens.startRevoke(name);
      await expect(tokens.revokeConfirmRow).toBeVisible();
    });

    await test.step("cancel", async () => {
      await tokens.cancelRevoke();
    });

    await test.step("check the token stays", async () => {
      await expect(tokens.revokeConfirmRow).toHaveCount(0);
      await expect(tokens.row(name)).toBeVisible();
    });
  });

  test("rename a token in place", async ({
    settingsPage,
    ownApiToken,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e rename ${uniqueSuffix()}`;
    const renamed = `${name} v2`;

    await test.step("create a token through the api", async () => {
      await ownApiToken(name);
    });

    await test.step("start renaming it", async () => {
      await settingsPage.goto("security");
      await tokens.startRename(name);
      await expect(tokens.renameField).toHaveValue(name);
    });

    await test.step("save the new name", async () => {
      await expectMutation(apiTokens.rename(), () =>
        tokens.saveRename(renamed),
      );
      await expect(tokens.row(renamed)).toBeVisible();
    });

    // It persisted rather than only re-rendered.
    await test.step("check the name survives a reload", async () => {
      await settingsPage.reload();
      await expect(tokens.row(renamed)).toBeVisible();
    });
  });

  test("show an error and keep the list unchanged when creation fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e fail ${uniqueSuffix()}`;

    await test.step("open the security section", async () => {
      await settingsPage.goto("security");
      await settingsPage.forceServerError(apiTokens.create(name));
    });

    await test.step("create a token", async () => {
      await expectMutation(failing(apiTokens.create(name)), () =>
        tokens.createToken(name),
      );
    });

    await test.step("check the error shows and no token appears", async () => {
      await expect(tokens.statusMessage).toBeVisible();
      await expect(tokens.statusMessage).toHaveClass(/error/);
      await expect(tokens.secretPanel).toHaveCount(0);
      await expect(tokens.row(name)).toHaveCount(0);
    });
  });

  test("show an error and keep the row when rename fails", async ({
    settingsPage,
    ownApiToken,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e rename-fail ${uniqueSuffix()}`;

    await test.step("create a token through the api", async () => {
      await ownApiToken(name);
    });

    await test.step("start renaming it", async () => {
      await settingsPage.goto("security");
      await settingsPage.forceServerError(apiTokens.rename());
      await tokens.startRename(name);
    });

    await test.step("save a new name", async () => {
      await expectMutation(failing(apiTokens.rename()), () =>
        tokens.saveRename(`${name} v2`),
      );
    });

    // Cancelling out of the edit row reveals the row under its original name.
    await test.step("check the error shows and the name is unchanged", async () => {
      await expect(tokens.statusMessage).toHaveClass(/error/);
      await tokens.cancelRename();
      await expect(tokens.row(name)).toBeVisible();
    });
  });

  test("show an error and keep the row when revoke fails", async ({
    settingsPage,
    ownApiToken,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e revoke-fail ${uniqueSuffix()}`;

    await test.step("create a token through the api", async () => {
      await ownApiToken(name);
    });

    await test.step("ask to revoke it", async () => {
      await settingsPage.goto("security");
      await settingsPage.forceServerError(apiTokens.revoke());
      await tokens.startRevoke(name);
      await expect(tokens.revokeConfirmRow).toBeVisible();
    });

    await test.step("confirm the revoke", async () => {
      await expectMutation(failing(apiTokens.revoke()), () =>
        tokens.confirmRevoke(),
      );
    });

    await test.step("check the error shows and the token survives", async () => {
      await expect(tokens.statusMessage).toHaveClass(/error/);
      await tokens.cancelRevoke();
      await expect(tokens.row(name)).toBeVisible();
    });
  });
});

// The copy must say whether it landed: on a plain-http LAN install there is no
// `navigator.clipboard`, and a silent failure there loses the secret.
test.describe("copying the secret", () => {
  test("copy the secret and say so", async ({
    settingsPage,
    createdApiTokenIds,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e copy ${uniqueSuffix()}`;

    await test.step("open the security section", async () => {
      await tokens.allowClipboard();
      await settingsPage.goto("security");
    });

    const secret = await test.step("create a token", async () => {
      const { response } = await expectMutation(apiTokens.create(name), () =>
        tokens.createToken(name),
      );
      const created: CreatedApiToken = await response.json();
      createdApiTokenIds.add(created.token.id);
      return tokens.readSecret();
    });

    await test.step("copy the secret", async () => {
      await tokens.copySecret();
    });

    await test.step("check the copy is announced and landed", async () => {
      await expect(tokens.secretCopyFeedback).toHaveText("Copied");
      expect(await tokens.clipboardText()).toBe(secret);
    });
  });

  test("say so when the secret can't be copied", async ({
    settingsPage,
    createdApiTokenIds,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;
    const name = `e2e copy-fail ${uniqueSuffix()}`;

    // No clipboard API (as on plain http) and a refused fallback copy.
    await test.step("open the security section without a clipboard", async () => {
      await tokens.stubClipboardUnavailable();
      await settingsPage.goto("security");
    });

    await test.step("create a token", async () => {
      const { response } = await expectMutation(apiTokens.create(name), () =>
        tokens.createToken(name),
      );
      const created: CreatedApiToken = await response.json();
      createdApiTokenIds.add(created.token.id);
    });

    await test.step("copy the secret", async () => {
      await tokens.copySecret();
    });

    await test.step("check the failure is announced and the secret stays", async () => {
      await expect(tokens.secretCopyFeedback).toHaveText(
        "Couldn\u2019t copy. Select and copy it.",
      );
      await expect(tokens.secretCopyFeedback).toHaveClass(/error/);
      await expect(tokens.secretPanel).toBeVisible();
    });
  });
});

// The endpoint switch lives under Administration › Integrations and is
// instance-wide: `presetMcpEndpoint` holds a lock for the tests that write it
// and puts it back off, the shipped default.
test.describe("hosted mcp endpoint", () => {
  test("show the hosted mcp endpoint card", async ({ adminPage }) => {
    const { mcp } = adminPage.integrations;

    await test.step("open the integrations section", async () => {
      await adminPage.goto("integrations");
    });

    await test.step("check the card", async () => {
      await expect(mcp.card).toBeVisible();
      await expect(mcp.heading).toBeVisible();
      await expect(mcp.state).toBeVisible();
      await expect(mcp.endpointField).toHaveText(mcp.instanceMcpUrl());
    });

    // The card waits for the status read before offering the switch.
    await test.step("check the switch is offered", async () => {
      await expect(mcp.toggle).toBeEnabled();
    });
  });

  test("enable the mcp endpoint", async ({
    adminPage,
    presetMcpEndpoint,
    expectMutation,
  }) => {
    const { mcp } = adminPage.integrations;

    await test.step("start with the endpoint off", async () => {
      await presetMcpEndpoint(false);
      await adminPage.goto("integrations");
      await expect(mcp.toggle).toBeEnabled();
    });

    await test.step("switch it on", async () => {
      await expectMutation(settings.setMcp(true), () => mcp.flip());
    });

    await test.step("check it reads enabled", async () => {
      await expect(mcp.status).toHaveClass(/success/);
      await expect(mcp.state).toHaveText("enabled");
      await expect(mcp.toggle).toHaveAttribute("aria-checked", "true");
    });
  });

  test("disable the mcp endpoint", async ({
    adminPage,
    presetMcpEndpoint,
    expectMutation,
  }) => {
    const { mcp } = adminPage.integrations;

    await test.step("start with the endpoint on", async () => {
      await presetMcpEndpoint(true);
      await adminPage.goto("integrations");
      await expect(mcp.toggle).toBeEnabled();
    });

    await test.step("switch it off", async () => {
      await expectMutation(settings.setMcp(false), () => mcp.flip());
    });

    await test.step("check it reads disabled", async () => {
      await expect(mcp.state).toHaveText("disabled");
      await expect(mcp.toggle).toHaveAttribute("aria-checked", "false");
    });
  });

  test("show an error and keep the switch state when the toggle fails", async ({
    adminPage,
    presetMcpEndpoint,
    expectMutation,
  }) => {
    const { mcp } = adminPage.integrations;

    await test.step("start with the endpoint off", async () => {
      await presetMcpEndpoint(false);
      await adminPage.goto("integrations");
      await expect(mcp.toggle).toBeEnabled();
      await adminPage.forceServerError(settings.setMcp(true));
    });

    await test.step("switch it on", async () => {
      await expectMutation(failing(settings.setMcp(true)), () => mcp.flip());
    });

    await test.step("check the error shows and the switch stays off", async () => {
      await expect(mcp.status).toHaveClass(/error/);
      await expect(mcp.state).toHaveText("disabled");
      await expect(mcp.toggle).toHaveAttribute("aria-checked", "false");
    });
  });
});
