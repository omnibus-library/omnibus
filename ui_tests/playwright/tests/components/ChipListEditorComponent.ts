import type { Locator, Page } from "@playwright/test";
import { metadataUrls } from "../contracts/metadata";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

export type ChipKind = "genres" | "tags";

const SINGULAR: Record<ChipKind, string> = { genres: "genre", tags: "tag" };

/** One chip row in the book detail hero, genres or tags, and its editor. */
export class ChipListEditorComponent extends BaseComponent {
  readonly root: Locator;
  readonly addButton: Locator;
  readonly otherAddButton: Locator;
  readonly list: Locator;
  readonly editorPanel: Locator;
  readonly input: Locator;
  readonly suggestionsList: Locator;

  constructor(page: Page, kind: ChipKind) {
    super(page);
    const noun = SINGULAR[kind];
    const otherKind = kind === "genres" ? "tags" : "genres";
    this.root = page.getByTestId(`bd-${noun}-row`);
    this.addButton = this.root.getByTestId(`bd-add-${kind}`);
    // #2257: the other kind's pill never sits in this row.
    this.otherAddButton = this.root.getByTestId(`bd-add-${otherKind}`);
    this.list = this.root.getByTestId(`bd-${noun}-list`);
    this.editorPanel = this.root.getByTestId(`bd-${kind}-editor`);
    // A test asserts the placeholder, so the input is found by test id.
    this.input = this.root.getByTestId(`bd-${kind}-input`);
    this.suggestionsList = this.root.getByTestId(`bd-${kind}-suggestions`);
  }

  async openEditor(): Promise<void> {
    await this.addButton.click();
  }

  /** Types `value` and saves it with Enter, then waits for the save. */
  async addChip(value: string): Promise<void> {
    await this.input.fill(value);
    const saved = this.page.waitForResponse(
      isPostTo(metadataUrls.saveOverrides),
    );
    await this.input.press("Enter");
    await saved;
  }

  async closeEditor(): Promise<void> {
    await this.input.press("Escape");
  }
}
