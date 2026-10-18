import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** Administration › Integrations → the switch for the hosted MCP endpoint. */
export class McpEndpointCardComponent extends BaseComponent {
  readonly card: Locator;
  readonly heading: Locator;
  readonly toggle: Locator;
  readonly state: Locator;
  readonly status: Locator;
  readonly endpointField: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("mcp-toggle-card");
    this.heading = page.getByRole("heading", { name: "Hosted MCP endpoint" });
    this.toggle = page.getByTestId("mcp-toggle");
    this.state = page.getByTestId("mcp-toggle-state");
    this.status = page.getByTestId("mcp-toggle-status");
    this.endpointField = page.getByTestId("mcp-endpoint-url");
  }

  /** The endpoint this instance serves MCP on, which the card shows. */
  instanceUrl(): string {
    return `${new URL(this.page.url()).origin}/mcp`;
  }

  async flip(): Promise<void> {
    await this.toggle.click();
  }
}
