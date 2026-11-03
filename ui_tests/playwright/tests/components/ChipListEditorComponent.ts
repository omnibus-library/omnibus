import type { Locator, Page } from "@playwright/test";
import { overridesUrls } from "../contracts/overrides";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

export type ChipKind = "genres" | "tags";

const SINGULAR: Record<ChipKind, string> = { genres: "genre", tags: "tag" };
const TITLE: Record<ChipKind, string> = { genres: "Genres", tags: "Tags" };

/** One chip row under the Overview's description, genres or tags, and its input. */
export class ChipListEditorComponent extends BaseComponent {
  readonly title: Locator;
  readonly root: Locator;
  readonly input: Locator;
  readonly otherInput: Locator;
  readonly list: Locator;
  readonly suggestions: Locator;

  constructor(page: Page, kind: ChipKind) {
    super(page);
    const otherKind = kind === "genres" ? "tags" : "genres";
    // A test asserts the placeholder, so the input is found by test id.
    this.input = page.getByTestId(`bp-add-${SINGULAR[kind]}`);
    this.title = page.getByRole("term").filter({ hasText: TITLE[kind] });
    this.root = page.getByRole("definition").filter({ has: this.input });
    // The other kind's input never sits in this row.
    this.otherInput = this.root.getByTestId(`bp-add-${SINGULAR[otherKind]}`);
    this.list = this.root;
    // The input's datalist; its options are what the browser offers.
    this.suggestions = this.root.locator("datalist option");
  }

  async openEditor(): Promise<void> {
    await this.input.click();
  }

  /** Types `value` and saves it with Enter, then waits for the save. */
  async addChip(value: string): Promise<void> {
    await this.input.fill(value);
    const saved = this.page.waitForResponse(isPostTo(overridesUrls.save));
    await this.input.press("Enter");
    await saved;
  }
}
