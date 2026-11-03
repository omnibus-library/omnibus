import type { Locator, Page } from "@playwright/test";
import { metadataUrls } from "../contracts/metadata";
import type { EditionAnswers, ProviderEdition } from "../data/editions";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** A provider as Fetch metadata names its edition: `open-library`, `google-books` or `hardcover`. */
export type ProviderSlug = "open-library" | "google-books" | "hardcover";

/**
 * Fetch metadata, in the editor sheet in place of its tabs: it searches every
 * configured provider as it opens, lists one edition per provider, and sets the
 * picked one against the form as rows to check and apply.
 */
export class MetadataFetchComponent extends BaseComponent {
  readonly openButton: Locator;
  readonly root: Locator;
  readonly backButton: Locator;
  readonly queryField: Locator;
  readonly authorField: Locator;
  readonly searchButton: Locator;
  readonly errorMessage: Locator;
  readonly editionList: Locator;
  readonly editionButtons: Locator;
  readonly hydratingNotice: Locator;
  readonly skeleton: Locator;
  readonly diff: Locator;
  readonly diffRows: Locator;
  readonly applyButton: Locator;
  readonly coverThumb: Locator;

  private answerHydrate?: (detail: ProviderEdition | null) => void;

  constructor(page: Page) {
    super(page);
    this.openButton = page.getByTestId("es-fetch");
    this.root = page.getByRole("region", { name: "Fetch metadata" });
    this.backButton = this.root.getByTestId("es-fetch-back");
    this.queryField = this.root.getByLabel("Title or ISBN");
    this.authorField = this.root.getByLabel("Author", { exact: true });
    this.searchButton = this.root.getByRole("button", {
      name: "Search",
      exact: true,
    });
    this.errorMessage = this.root.getByRole("alert");
    this.editionList = this.root.getByRole("list", {
      name: "Matching editions",
    });
    this.editionButtons = this.editionList.getByRole("button");
    this.hydratingNotice = this.root.getByText("Loading the full record…");
    this.skeleton = this.root.getByTestId("es-diff-skeleton");
    this.diff = this.root.getByTestId("es-diff");
    this.diffRows = this.diff.getByRole("listitem");
    this.applyButton = this.root.getByTestId("es-apply");
    this.coverThumb = this.diff.getByRole("img", { name: "New cover" });
  }

  /** The button that picks the edition `slug` found. */
  editionButton(slug: ProviderSlug): Locator {
    return this.root.getByTestId(`es-edition-${slug}`);
  }

  editionCover(slug: ProviderSlug): Locator {
    return this.editionButton(slug).locator("img");
  }

  /** What a source contributed, by its slug. */
  sourceNote(slug: ProviderSlug): Locator {
    return this.root.getByTestId(`mes-source-${slug}`);
  }

  /** The diff row for a field, by its label such as `Publisher` or `Cover`. */
  diffRow(label: string): Locator {
    return this.diffRows.filter({
      has: this.page.getByText(label, { exact: true }),
    });
  }

  diffCheckbox(label: string): Locator {
    return this.diffRow(label).getByRole("checkbox");
  }

  /** Answers the catalog, and the search and re-fetch of an edition if given. */
  async stubEditionLookup(answers: EditionAnswers): Promise<void> {
    await this.stub("GET", metadataUrls.providers, answers.catalog);
    await this.stub("POST", metadataUrls.hydrate, null);
    if (answers.found) {
      await this.stub("POST", metadataUrls.search, answers.found);
    }
  }

  /** Parks every re-fetch of an edition until `releaseHydrate` answers them. */
  async holdHydrate(): Promise<void> {
    const answer = new Promise<ProviderEdition | null>((resolve) => {
      this.answerHydrate = resolve;
    });
    await this.page.route(metadataUrls.hydrate, async (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: await answer })
        : route.continue(),
    );
  }

  releaseHydrate(detail: ProviderEdition | null): void {
    this.answerHydrate?.(detail);
  }

  /** Opens the view, which searches at once; a test that asserts the search wraps it. */
  async open(): Promise<void> {
    await this.openButton.click();
    await this.root.waitFor();
  }

  /** Opens the view and waits for the search it sends as it opens. */
  async openAndSearch(): Promise<void> {
    const searched = this.page.waitForResponse(isPostTo(metadataUrls.search));
    await this.open();
    await searched;
  }

  /** Types into the fields given, leaving the other as it is. */
  async enterQuery(query: { query?: string; author?: string }): Promise<void> {
    if (query.query !== undefined) await this.queryField.fill(query.query);
    if (query.author !== undefined) await this.authorField.fill(query.author);
  }

  async search(): Promise<void> {
    const searched = this.page.waitForResponse(isPostTo(metadataUrls.search));
    await this.searchButton.click();
    await searched;
  }

  /** Picks an edition, which re-fetches its full record before its diff shows. */
  async pickEdition(slug: ProviderSlug): Promise<void> {
    await this.editionButton(slug).click();
  }

  /** Checks exactly the diff rows named in `labels`, and unchecks the rest. */
  async choose(labels: string[]): Promise<void> {
    await this.diff.waitFor();
    const count = await this.diffRows.count();
    for (let i = 0; i < count; i++) {
      const row = this.diffRows.nth(i);
      const name = await row.locator(".es-diff-name").textContent();
      await row
        .getByRole("checkbox")
        .setChecked(labels.includes(name?.trim() ?? ""));
    }
  }

  /** Checks every diff row, the cover's included. */
  async chooseAll(): Promise<void> {
    await this.diff.waitFor();
    const count = await this.diffRows.count();
    for (let i = 0; i < count; i++) {
      await this.diffRows.nth(i).getByRole("checkbox").check();
    }
  }

  /** Copies the checked rows into the form and goes back to the tabs. */
  async apply(): Promise<void> {
    await this.applyButton.click();
  }

  /** Leaves through Back to editing, applying nothing. */
  async back(): Promise<void> {
    await this.backButton.click();
  }

  /** Leaves by pressing Fetch metadata again, which toggles the view shut. */
  async toggleClosed(): Promise<void> {
    await this.openButton.click();
  }

  private async stub(
    method: "GET" | "POST",
    url: RegExp,
    json: unknown,
  ): Promise<void> {
    await this.page.route(url, (route) =>
      route.request().method() === method
        ? route.fulfill({ json })
        : route.continue(),
    );
  }
}
