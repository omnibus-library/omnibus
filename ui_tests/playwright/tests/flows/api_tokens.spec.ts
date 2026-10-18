import { apiTokens } from "../contracts/apiTokens";
import type { CreatedApiToken } from "../data/account";
import { uniqueSuffix } from "../data/unique";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// Tokens are per-user state on the shared admin, so every test names its own
// uniquely and a fixture revokes what it made; counts are never asserted, only
// the presence or absence of a test's own rows.

test.describe("api tokens section", () => {
  test("show the api tokens section layout", async ({ settingsPage }) => {
    const tokens = settingsPage.apiTokens;

    await test.step("open the api tokens section", async () => {
      await settingsPage.goto("api-tokens");
    });

    await test.step("check the settings frame", async () => {
      await settingsPage.assertDisplayed();
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

    await test.step("open the api tokens section", async () => {
      await settingsPage.goto("api-tokens");
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

    await test.step("check the new row", async () => {
      await expect(tokens.row(name)).toBeVisible();
      await expect(tokens.rowIdentifier(name, secret)).toBeVisible();
      await expect(tokens.rowPill(name)).toHaveText("Never used");
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

    await test.step("open the api tokens section", async () => {
      await settingsPage.goto("api-tokens");
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
      await settingsPage.goto("api-tokens");
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
      await settingsPage.goto("api-tokens");
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

    await test.step("open the api tokens section", async () => {
      await settingsPage.goto("api-tokens");
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
      await settingsPage.goto("api-tokens");
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
      await settingsPage.goto("api-tokens");
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

// The endpoint switch is instance-wide: `presetMcpEndpoint` holds a lock for the
// tests that write it and puts it back off, the shipped default.
test.describe("hosted mcp endpoint", () => {
  test("show the hosted mcp endpoint card", async ({ settingsPage }) => {
    const tokens = settingsPage.apiTokens;

    await test.step("open the api tokens section", async () => {
      await settingsPage.goto("api-tokens");
    });

    await test.step("check the card", async () => {
      await expect(tokens.mcpCard).toBeVisible();
      await expect(tokens.mcpHeading).toBeVisible();
      await expect(tokens.mcpState).toBeVisible();
      await expect(tokens.mcpEndpointField).toHaveText(tokens.instanceMcpUrl());
    });

    // The card waits for the status read before offering the switch.
    await test.step("check the switch is offered", async () => {
      await expect(tokens.mcpSwitch).toBeEnabled();
    });
  });

  test("enable the mcp endpoint", async ({
    settingsPage,
    presetMcpEndpoint,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;

    await test.step("start with the endpoint off", async () => {
      await presetMcpEndpoint(false);
      await settingsPage.goto("api-tokens");
      await expect(tokens.mcpSwitch).toBeEnabled();
    });

    await test.step("switch it on", async () => {
      await expectMutation(apiTokens.setMcp(true), () => tokens.toggleMcp());
    });

    await test.step("check it reads enabled", async () => {
      await expect(tokens.mcpStatus).toHaveClass(/success/);
      await expect(tokens.mcpState).toHaveText("enabled");
      await expect(tokens.mcpSwitch).toHaveAttribute("aria-checked", "true");
    });
  });

  test("disable the mcp endpoint", async ({
    settingsPage,
    presetMcpEndpoint,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;

    await test.step("start with the endpoint on", async () => {
      await presetMcpEndpoint(true);
      await settingsPage.goto("api-tokens");
      await expect(tokens.mcpSwitch).toBeEnabled();
    });

    await test.step("switch it off", async () => {
      await expectMutation(apiTokens.setMcp(false), () => tokens.toggleMcp());
    });

    await test.step("check it reads disabled", async () => {
      await expect(tokens.mcpState).toHaveText("disabled");
      await expect(tokens.mcpSwitch).toHaveAttribute("aria-checked", "false");
    });
  });

  test("show an error and keep the switch state when the toggle fails", async ({
    settingsPage,
    presetMcpEndpoint,
    expectMutation,
  }) => {
    const tokens = settingsPage.apiTokens;

    await test.step("start with the endpoint off", async () => {
      await presetMcpEndpoint(false);
      await settingsPage.goto("api-tokens");
      await expect(tokens.mcpSwitch).toBeEnabled();
      await settingsPage.forceServerError(apiTokens.setMcp(true));
    });

    await test.step("switch it on", async () => {
      await expectMutation(failing(apiTokens.setMcp(true)), () =>
        tokens.toggleMcp(),
      );
    });

    await test.step("check the error shows and the switch stays off", async () => {
      await expect(tokens.mcpStatus).toHaveClass(/error/);
      await expect(tokens.mcpState).toHaveText("disabled");
      await expect(tokens.mcpSwitch).toHaveAttribute("aria-checked", "false");
    });
  });
});
