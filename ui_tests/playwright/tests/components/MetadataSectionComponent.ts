import type { Page } from "@playwright/test";
import type { MetadataProvider } from "../data/metadataKeys";
import { BaseComponent } from "./BaseComponent";
import { MetadataKeyCardComponent } from "./MetadataKeyCardComponent";

/** Settings → Metadata Lookup: the API keys of the providers a lookup tries. */
export class MetadataSectionComponent extends BaseComponent {
  private readonly keyCards: Record<MetadataProvider, MetadataKeyCardComponent>;

  constructor(page: Page) {
    super(page);
    this.keyCards = {
      hardcover: new MetadataKeyCardComponent(
        page,
        "hardcover",
        "Hardcover API Key",
      ),
      "google-books": new MetadataKeyCardComponent(
        page,
        "google-books",
        "Google Books API Key",
      ),
    };
  }

  /** The card holding `provider`'s API key. */
  keyCard(provider: MetadataProvider): MetadataKeyCardComponent {
    return this.keyCards[provider];
  }
}
