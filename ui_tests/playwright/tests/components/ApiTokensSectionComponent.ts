import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** Settings › Sign-in & security → API tokens: the list, and the one-time secret hand-off. */
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
  readonly secretCopyFeedback: Locator;
  readonly secretDismissButton: Locator;
  readonly mcpCommand: Locator;
  readonly mcpCommandCopyButton: Locator;

  readonly revokeConfirmRow: Locator;
  readonly revokeCancelButton: Locator;
  readonly renameField: Locator;
  readonly renameSaveButton: Locator;
  readonly renameCancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("api-tokens-card");
    this.heading = page.getByRole("heading", { level: 3, name: "API tokens" });
    this.liveCount = page.getByTestId("api-tokens-count");
    this.scope = page.getByTestId("api-tokens-scope");
    this.nameField = page.getByTestId("api-token-name-input");
    this.createButton = page.getByTestId("api-token-create");
    this.statusMessage = page.getByTestId("api-tokens-status");

    this.secretPanel = page.getByTestId("api-token-secret-field");
    this.secretField = page.getByTestId("api-token-secret");
    this.secretCopyButton = page.getByTestId("api-token-secret-copy");
    this.secretCopyFeedback = page.getByTestId(
      "api-token-secret-copy-feedback",
    );
    this.secretDismissButton = page.getByTestId("api-token-secret-dismiss");
    this.mcpCommand = page.getByTestId("api-token-mcp-command");
    this.mcpCommandCopyButton = page.getByTestId("api-token-mcp-command-copy");

    this.revokeConfirmRow = page.getByTestId("api-token-revoke-confirm");
    this.revokeCancelButton = page.getByTestId("api-token-revoke-cancel");
    this.renameField = page.getByTestId("api-token-rename-input");
    this.renameSaveButton = page.getByTestId("api-token-rename-save");
    this.renameCancelButton = page.getByTestId("api-token-rename-cancel");
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
    await this.row(name)
      .getByRole("button", { name: `Revoke ${name}`, exact: true })
      .click();
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
    await this.row(name)
      .getByRole("button", { name: `Rename ${name}`, exact: true })
      .click();
  }

  async saveRename(newName: string): Promise<void> {
    await this.renameField.fill(newName);
    await this.renameSaveButton.click();
  }

  async cancelRename(): Promise<void> {
    await this.renameCancelButton.click();
  }

  async copySecret(): Promise<void> {
    await this.secretCopyButton.click();
  }

  /** Lets the page read and write the clipboard, as a reader's browser does after a prompt. */
  async allowClipboard(): Promise<void> {
    await this.page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  }

  /** What the clipboard holds now. */
  async clipboardText(): Promise<string> {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  /** Removes the clipboard API and refuses the fallback copy, as on a plain-http install. */
  async stubClipboardUnavailable(): Promise<void> {
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined });
      document.execCommand = () => false;
    });
  }
}
