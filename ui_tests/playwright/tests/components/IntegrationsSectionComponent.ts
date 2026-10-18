import type { Page } from "@playwright/test";
import type { MetadataProvider } from "../data/metadataKeys";
import { BaseComponent } from "./BaseComponent";
import { McpEndpointCardComponent } from "./McpEndpointCardComponent";
import { MetadataKeyCardComponent } from "./MetadataKeyCardComponent";
import { SmtpCardComponent } from "./SmtpCardComponent";

/** Administration › Integrations: the SMTP relay, the provider API keys and MCP. */
export class IntegrationsSectionComponent extends BaseComponent {
  readonly smtp: SmtpCardComponent;
  readonly mcp: McpEndpointCardComponent;
  private readonly keyCards: Record<MetadataProvider, MetadataKeyCardComponent>;

  constructor(page: Page) {
    super(page);
    this.smtp = new SmtpCardComponent(page);
    this.mcp = new McpEndpointCardComponent(page);
    this.keyCards = {
      hardcover: new MetadataKeyCardComponent(
        page,
        "hardcover",
        "Hardcover API key",
      ),
      "google-books": new MetadataKeyCardComponent(
        page,
        "google-books",
        "Google Books API key",
      ),
    };
  }

  /** The card holding `provider`'s API key. */
  keyCard(provider: MetadataProvider): MetadataKeyCardComponent {
    return this.keyCards[provider];
  }
}
