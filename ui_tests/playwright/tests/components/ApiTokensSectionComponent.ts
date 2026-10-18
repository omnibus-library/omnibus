import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** Settings → API Tokens: the token list, plus the hosted MCP endpoint card. */
export class ApiTokensSectionComponent extends BaseComponent {
  readonly card: Locator;
  readonly heading: Locator;
  readonly liveCount: Locator;
  readonly scope: Locator;
  readonly nameField: Locator;
  readonly createButton: Locator;
  readonly statusMessage: Locator;

  readonly secretPanel: Locator;
  readonly secretField: Locator;
  readonly secretCopyButton: Locator;
  readonly secretDismissButton: Locator;
  readonly mcpCommand: Locator;
  readonly mcpCommandCopyButton: Locator;

  readonly revokeConfirmRow: Locator;
  readonly revokeCancelButton: Locator;
  readonly renameField: Locator;
  readonly renameSaveButton: Locator;
  readonly renameCancelButton: Locator;

  readonly mcpCard: Locator;
  readonly mcpHeading: Locator;
  readonly mcpSwitch: Locator;
  readonly mcpState: Locator;
  readonly mcpStatus: Locator;
  readonly mcpEndpointField: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("api-tokens-card");
    this.heading = page.getByRole("heading", { name: "API Tokens" });
    this.liveCount = page.getByTestId("api-tokens-count");
    this.scope = page.getByTestId("api-tokens-scope");
    this.nameField = page.getByTestId("api-token-name-input");
    this.createButton = page.getByTestId("api-token-create");
    this.statusMessage = page.getByTestId("api-tokens-status");

    this.secretPanel = page.getByTestId("api-token-secret-field");
    this.secretField = page.getByTestId("api-token-secret");
    this.secretCopyButton = page.getByTestId("api-token-secret-copy");
    this.secretDismissButton = page.getByTestId("api-token-secret-dismiss");
    this.mcpCommand = page.getByTestId("api-token-mcp-command");
    this.mcpCommandCopyButton = page.getByTestId("api-token-mcp-command-copy");

    this.revokeConfirmRow = page.getByTestId("api-token-revoke-confirm");
    this.revokeCancelButton = page.getByTestId("api-token-revoke-cancel");
    this.renameField = page.getByTestId("api-token-rename-input");
    this.renameSaveButton = page.getByTestId("api-token-rename-save");
    this.renameCancelButton = page.getByTestId("api-token-rename-cancel");

    this.mcpCard = page.getByTestId("mcp-toggle-card");
    this.mcpHeading = page.getByRole("heading", {
      name: "Hosted MCP endpoint",
    });
    this.mcpSwitch = page.getByTestId("mcp-toggle");
    this.mcpState = page.getByTestId("mcp-toggle-state");
    this.mcpStatus = page.getByTestId("mcp-toggle-status");
    this.mcpEndpointField = page.getByTestId("mcp-endpoint-url");
  }

  row(name: string): Locator {
    return this.page.getByTestId("api-token-row").filter({ hasText: name });
  }

  rowPill(name: string): Locator {
    return this.row(name).getByTestId("api-token-pill");
  }

  /** The `omni_…xxxx` tail a row shows in place of the secret. */
  rowIdentifier(name: string, secret: string): Locator {
    return this.row(name).getByText(`omni_…${secret.slice(-4)}`);
  }

  /** The endpoint this instance serves MCP on, which the card and the command both carry. */
  instanceMcpUrl(): string {
    return `${new URL(this.page.url()).origin}/mcp`;
  }

  /** The secret as the hand-off panel shows it, which exists only until it is dismissed. */
  async readSecret(): Promise<string> {
    return (await this.secretField.textContent()) ?? "";
  }

  async createToken(name: string): Promise<void> {
    await this.nameField.fill(name);
    await this.createButton.click();
  }

  async dismissSecret(): Promise<void> {
    await this.secretDismissButton.click();
  }

  /** Revoking is two steps: the row's button swaps in a confirmation. */
  async startRevoke(name: string): Promise<void> {
    await this.row(name).getByRole("button", { name: "Revoke" }).click();
  }

  async confirmRevoke(): Promise<void> {
    await this.revokeConfirmRow
      .getByRole("button", { name: "Revoke token" })
      .click();
  }

  async cancelRevoke(): Promise<void> {
    await this.revokeCancelButton.click();
  }

  async startRename(name: string): Promise<void> {
    await this.row(name).getByRole("button", { name: "Rename" }).click();
  }

  async saveRename(newName: string): Promise<void> {
    await this.renameField.fill(newName);
    await this.renameSaveButton.click();
  }

  async cancelRename(): Promise<void> {
    await this.renameCancelButton.click();
  }

  async toggleMcp(): Promise<void> {
    await this.mcpSwitch.click();
  }
}
