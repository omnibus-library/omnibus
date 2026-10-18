import type { Locator, Page, Request } from "@playwright/test";
import { metadataUrls } from "../contracts/metadata";
import type { EditionAnswers, ProviderEdition } from "../data/editions";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";
import { MetadataCompareComponent } from "./MetadataCompareComponent";

/**
 * The edition picker on the edit page: a two-screen overlay that searches every
 * configured provider, then compares one candidate against the book. It opens
 * on its fields and searches only when asked.
 */
export class MetadataSearchOverlayComponent extends BaseComponent {
  readonly compare: MetadataCompareComponent;

  readonly openButton: Locator;
  readonly root: Locator;
  readonly scrim: Locator;
  readonly closeButton: Locator;
  readonly titleQueryField: Locator;
  readonly authorQueryField: Locator;
  readonly isbnQueryField: Locator;
  readonly searchButton: Locator;
  readonly readyNote: Locator;
  readonly candidateList: Locator;
  readonly errorMessage: Locator;

  private answerHydrate?: (detail: ProviderEdition | null) => void;

  constructor(page: Page) {
    super(page);
    this.compare = new MetadataCompareComponent(page);
    this.openButton = page.getByTestId("metadata-search-btn");
    this.root = page.getByTestId("metadata-search");
    this.scrim = page.getByTestId("metadata-search-scrim");
    this.closeButton = page.getByTestId("mes-close");
    this.titleQueryField = page.getByTestId("mes-query-title");
    this.authorQueryField = page.getByTestId("mes-query-author");
    this.isbnQueryField = page.getByTestId("mes-query-isbn");
    this.searchButton = page.getByTestId("mes-search");
    this.readyNote = page.getByTestId("mes-ready");
    this.candidateList = page.getByTestId("mes-candidates");
    this.errorMessage = page.getByTestId("mes-error");
  }

  candidateRow(index: number): Locator {
    return this.page.getByTestId(`mes-candidate-${index}`);
  }

  candidateCover(index: number): Locator {
    return this.candidateRow(index).locator("img");
  }

  candidateTitle(index: number): Locator {
    return this.page.getByTestId(`mes-candidate-${index}-title`);
  }

  candidateAuthors(index: number): Locator {
    return this.page.getByTestId(`mes-candidate-${index}-authors`);
  }

  candidateImprint(index: number): Locator {
    return this.page.getByTestId(`mes-candidate-${index}-imprint`);
  }

  candidateSource(index: number): Locator {
    return this.page.getByTestId(`mes-candidate-${index}-source`);
  }

  /** What a source contributed, by the slug of its name, such as `open-library`. */
  sourceNote(slug: string): Locator {
    return this.page.getByTestId(`mes-source-${slug}`);
  }

  /** Answers the catalog, and the search and re-fetch of a candidate if given. */
  async stubEditionLookup(answers: EditionAnswers): Promise<void> {
    await this.stub("GET", metadataUrls.providers, answers.catalog);
    await this.stub("POST", metadataUrls.hydrate, null);
    if (answers.found) {
      await this.stub("POST", metadataUrls.search, answers.found);
    }
  }

  /** Parks every re-fetch of a candidate until `releaseHydrate` answers them. */
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

  /** A live list of the searches this page sends from now on. */
  recordSearches(): Request[] {
    const sent: Request[] = [];
    this.page.on("request", (request) => {
      if (metadataUrls.search.test(request.url())) sent.push(request);
    });
    return sent;
  }

  async open(): Promise<void> {
    await this.openButton.click();
    await this.root.waitFor();
  }

  /** Types into the query fields given, leaving the others as they are. */
  async enterQuery(query: {
    title?: string;
    author?: string;
    isbn?: string;
  }): Promise<void> {
    if (query.title !== undefined) {
      await this.titleQueryField.fill(query.title);
    }
    if (query.author !== undefined) {
      await this.authorQueryField.fill(query.author);
    }
    if (query.isbn !== undefined) {
      await this.isbnQueryField.fill(query.isbn);
    }
  }

  async search(): Promise<void> {
    const searched = this.page.waitForResponse(isPostTo(metadataUrls.search));
    await this.searchButton.click();
    await searched;
  }

  async openAndSearch(): Promise<void> {
    await this.open();
    await this.search();
  }

  /** Opens the compare screen on the candidate in row `index`. */
  async pickCandidate(index: number): Promise<void> {
    await this.candidateRow(index).click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }

  /** Clicks the scrim rather than the card; a click on the card itself must not dismiss. */
  async closeByClickingOutside(): Promise<void> {
    await this.scrim.click({ position: { x: 5, y: 5 } });
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
