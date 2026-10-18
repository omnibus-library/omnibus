import type { Locator, Page } from "@playwright/test";
import { expectedPublishedText } from "../data/ebooks";
import type { ExpectedBook } from "../fixtures/epubs";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";

/** What the series cell reads: `Name #N`, the bare name, or nothing. */
function expectedSeriesText(book: ExpectedBook): string {
  if (book.series && book.seriesIndex) {
    return `${book.series} #${book.seriesIndex}`;
  }
  return book.series ?? "";
}

/** The landing library as a table, which the grid view replaces by default. */
export class LibraryTableComponent extends BaseComponent {
  readonly root: Locator;
  readonly viewToggleButton: Locator;
  readonly rows: Locator;
  readonly selectAllBox: Locator;
  readonly selectBoxes: Locator;
  readonly titleSortButton: Locator;
  readonly titleColumnHeader: Locator;
  readonly descendingHeader: Locator;
  readonly firstRowTitleCell: Locator;
  readonly firstCoverImage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("ebook-table");
    this.viewToggleButton = page.getByTestId("view-toggle-table");
    this.rows = page.getByTestId(/^ebook-row-/);
    this.selectAllBox = page.getByTestId("ebook-select-all");
    this.selectBoxes = page.getByTestId("ebook-select");
    this.titleSortButton = page.getByRole("button", {
      name: /^Title( ↑| ↓)?$/,
    });
    this.titleColumnHeader = page.getByRole("columnheader", { name: /Title/ });
    this.descendingHeader = page.locator(".sort-th[aria-sort='descending']");
    this.firstRowTitleCell = this.rows.first().getByTestId("ebook-cell-title");
    this.firstCoverImage = this.rows
      .filter({ has: page.getByRole("img", { name: /^Cover of/ }) })
      .first()
      .getByRole("img", { name: /^Cover of/ });
  }

  /** A book's row, found by its fixture slug. */
  row(slug: string): Locator {
    return this.page.getByTestId(`ebook-row-${slug}`);
  }

  /** One cell of a book's row; `column` is `title`, `author`, `genres`, … */
  cell(slug: string, column: string): Locator {
    return this.row(slug).getByTestId(`ebook-cell-${column}`);
  }

  /** The editor an editable cell opens when clicked. */
  cellInput(slug: string, column: string): Locator {
    return this.cell(slug, column).getByTestId(`ebook-cell-${column}-input`);
  }

  /** The suggestion dropdown under a chip cell's editor. */
  cellSuggestions(slug: string, column: string): Locator {
    return this.cell(slug, column).getByTestId(
      `ebook-cell-${column}-suggestions`,
    );
  }

  /** The selection checkbox in a book's row. */
  selectBox(slug: string): Locator {
    return this.row(slug).getByTestId("ebook-select");
  }

  /** The cover shown in a book's row, whatever its title. */
  coverImage(slug: string): Locator {
    return this.row(slug).getByRole("img", { name: /^Cover of/ });
  }

  /** Every image in a book's cover cell. */
  coverCellImages(slug: string): Locator {
    return this.cell(slug, "cover").getByRole("img");
  }

  /** The link on a row's cover cell that opens the book. */
  openLink(slug: string, title: string): Locator {
    return this.row(slug).getByRole("link", {
      name: `Open details for ${title}`,
    });
  }

  /** The dash a book without a cover shows in its place. */
  coverFallback(slug: string): Locator {
    return this.cell(slug, "cover").getByText("—");
  }

  /** A chip already in a cell, such as an author's name. */
  chip(slug: string, column: string, text: string): Locator {
    return this.cell(slug, column).getByText(text, { exact: true });
  }

  /** The button that takes `author` off the book. */
  removeAuthorButton(slug: string, author: string): Locator {
    return this.cell(slug, "author").getByRole("button", {
      name: `Remove ${author}`,
    });
  }

  /** The button that takes `tag` off the book. */
  removeTagButton(slug: string, tag: string): Locator {
    return this.cell(slug, "tags").getByRole("button", {
      name: `Remove tag ${tag}`,
    });
  }

  /** A suggestion in a chip cell's dropdown, found by its name. */
  suggestion(slug: string, column: string, name: RegExp): Locator {
    return this.cellSuggestions(slug, column).getByRole("option", { name });
  }

  /** The heading over a chip cell's suggestions, such as `ADD AUTHOR`. */
  suggestionHeading(slug: string, column: string, text: string): Locator {
    return this.cellSuggestions(slug, column).getByText(text);
  }

  async switchTo(): Promise<void> {
    await this.viewToggleButton.click();
    await this.root.waitFor();
  }

  async openBook(slug: string, title: string): Promise<void> {
    await this.openLink(slug, title).click();
  }

  async sortByTitle(): Promise<void> {
    await this.titleSortButton.click();
  }

  /** The `srcset` of the first cover in the table, or null before it has one. */
  async firstCoverSrcset(): Promise<string | null> {
    return this.firstCoverImage.getAttribute("srcset");
  }

  /** What a cell reads, trimmed. */
  async cellText(slug: string, column: string): Promise<string> {
    return (await this.cell(slug, column).innerText()).trim();
  }

  /** Ticks the selection checkbox of every book in `slugs`. */
  async selectRows(slugs: string[]): Promise<void> {
    for (const slug of slugs) {
      await this.selectBox(slug).check();
    }
  }

  async selectAll(): Promise<void> {
    await this.selectAllBox.check();
  }

  async deselectAll(): Promise<void> {
    await this.selectAllBox.uncheck();
  }

  /** Opens a cell's editor, which the click must do without opening the book. */
  async openCell(slug: string, column: string): Promise<void> {
    await this.cell(slug, column).click();
  }

  async fillCell(slug: string, column: string, text: string): Promise<void> {
    await this.cellInput(slug, column).fill(text);
  }

  /** Saves what the cell's editor holds. */
  async commitCell(slug: string, column: string): Promise<void> {
    await this.cellInput(slug, column).press("Enter");
  }

  /** Closes the cell's editor without saving. */
  async cancelCell(slug: string, column: string): Promise<void> {
    await this.cellInput(slug, column).press("Escape");
  }

  /** Moves focus from the editor's input back to the chip before it, once the input holds it. */
  async tabBackFromCell(slug: string, column: string): Promise<void> {
    const input = this.cellInput(slug, column);
    // The input takes focus a frame after it mounts and would pull it back from the chip.
    await input.and(this.page.locator(":focus")).waitFor();
    await input.press("Shift+Tab");
  }

  async removeTag(slug: string, tag: string): Promise<void> {
    await this.removeTagButton(slug, tag).click();
  }

  async chooseSuggestion(
    slug: string,
    column: string,
    name: RegExp,
  ): Promise<void> {
    await this.suggestion(slug, column, name).click();
  }

  /** Checks every cell of a book's row against the metadata it was built from. */
  async assertRowMatches(book: ExpectedBook): Promise<void> {
    await expect(
      this.row(book.slug),
      `row for slug "${book.slug}" should be visible`,
    ).toBeVisible();
    // landing_inline_edit.spec.ts edits standalone-ocean's title and authors
    // (and tags) in parallel with this check, so those cells are not pinned.
    if (!book.titleAndAuthorsEdited) {
      await expect(this.cell(book.slug, "title")).toHaveText(book.title);
      await expect(this.cell(book.slug, "author")).toHaveText(
        book.authors.join(", "),
      );
    }
    await expect(this.cell(book.slug, "series")).toHaveText(
      expectedSeriesText(book),
    );
    // Public-domain books carry long subject lists, so their fixtures leave
    // tags unpinned, as does the book above.
    if (book.tags) {
      await expect(this.cell(book.slug, "tags")).toHaveText(
        book.tags.join(", "),
      );
    }
    await expect(this.cell(book.slug, "published")).toHaveText(
      expectedPublishedText(book.published ?? ""),
    );
    await expect(this.cell(book.slug, "language")).toHaveText(book.language);
    if (book.hasCover) {
      await expect(
        this.cell(book.slug, "cover").getByRole("img", {
          name: book.titleAndAuthorsEdited
            ? /^Cover of /
            : `Cover of ${book.title}`,
        }),
      ).toBeVisible();
    } else {
      await expect(this.cell(book.slug, "cover")).toHaveText("—");
    }
  }
}
