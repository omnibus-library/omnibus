import type { Page } from "@playwright/test";
import { AUDIOBOOK_BOOKS } from "../fixtures/audiobooks";
import { type ExpectedBook, FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { switchToTableView } from "../utils/ebooks";
import { expectNavVisible, gotoReady, waitForHydration } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The filter is client-side view state, saved per library path in
// localStorage, and a Playwright context starts with none — so these tests run
// on the shared admin without leaving anything behind. They assert on the
// public-domain PDFs and the Compiler Compendium books: no other spec edits
// either, and (unlike tags and genres) nothing holds an override on them.
const PAGE_RPC = "/api/rpc/ebooks/page";
const FIELDS = ["shelf", "tag", "genre", "author", "series", "format"] as const;
const FILTERED_AUTHORS = [
  "Alfred Aho",
  "Jeffrey Ullman",
  "Monica Lam",
  "Ravi Sethi",
  "H. G. Wells",
];

type Field = (typeof FIELDS)[number];
type Mode = "include" | "exclude";
interface Pick {
  label: string;
  search?: string;
}
interface ClauseSpec {
  field: Field;
  mode: Mode;
  picks: Pick[];
}

test.beforeAll(async ({ request }) => {
  // The expected sets below come from the ebook fixtures alone; they hold only
  // while no audiobook fixture shares one of these authors.
  for (const audiobook of AUDIOBOOK_BOOKS) {
    expect(
      FILTERED_AUTHORS,
      `${audiobook.title} shares an author`,
    ).not.toContain(audiobook.author);
  }
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

const bar = (page: Page) => page.getByTestId("lib-filter-bar");
const chips = (page: Page) => page.getByTestId(/^filter-chip-\d+$/);
const clearAll = (page: Page) => page.getByTestId("filter-clear-all");
const picker = (page: Page) => page.getByTestId("filter-picker");

/** The fixtures `matches` selects, as the tile slugs the grid should show. */
function expectedSlugs(matches: (book: ExpectedBook) => boolean): string[] {
  return FIXTURE_BOOKS.filter(matches)
    .map((b) => b.slug)
    .sort();
}

const hasFormat = (book: ExpectedBook, extension: string) =>
  book.filename.toLowerCase().endsWith(`.${extension}`);

const authoredBy = (book: ExpectedBook, ...authors: string[]) =>
  book.authors.some((a) => authors.includes(a));

async function shownSlugs(page: Page): Promise<string[]> {
  return page.getByTestId(/^ebook-tile-/).evaluateAll((tiles) =>
    tiles
      .map((t) => t.getAttribute("data-testid")?.slice("ebook-tile-".length))
      .filter((slug): slug is string => slug !== undefined)
      .sort(),
  );
}

async function expectShown(page: Page, slugs: string[]): Promise<void> {
  await expect
    .poll(() => shownSlugs(page), { message: "tiles on the grid" })
    .toEqual(slugs);
  const count = slugs.length;
  await expect(page.getByTestId("lib-section-title")).toContainText(
    `· ${count} ${count === 1 ? "book" : "books"}`,
  );
}

async function headerCount(page: Page): Promise<number> {
  const title = page.getByTestId("lib-section-title");
  await expect(title).toContainText(/·\s*\d+\s+books?/);
  const text = (await title.textContent()) ?? "";
  return Number(/·\s*(\d+)\s+books?/.exec(text)?.[1]);
}

/** Count every "No ebooks found." node the page inserts from now on. */
async function recordEmptyLibraryInsertions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { count: 0 };
    Object.assign(window, { __emptyLibrarySeen: seen });
    new MutationObserver((mutations) => {
      for (const added of mutations.flatMap((m) => [...m.addedNodes])) {
        if (
          added instanceof Element &&
          (added.matches('[data-testid="lib-empty"]') ||
            added.querySelector('[data-testid="lib-empty"]'))
        ) {
          seen.count += 1;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function emptyLibraryInsertions(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __emptyLibrarySeen: { count: number } })
        .__emptyLibrarySeen.count,
  );
}

/** Build one clause in the picker and apply it, waiting on the page-1 refetch. */
async function addClause(page: Page, spec: ClauseSpec) {
  await page.getByTestId("filter-add").click();
  const popover = picker(page);
  await popover.getByTestId(`filter-field-${spec.field}`).click();
  await popover.getByTestId(`filter-mode-${spec.mode}`).click();
  await expect(popover.getByTestId(`filter-mode-${spec.mode}`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const pick of spec.picks) {
    await popover.getByTestId("filter-picker-search").fill(pick.search ?? "");
    await popover.getByLabel(pick.label, { exact: true }).check();
  }
  return expectMutation(
    page,
    { method: "POST", url: PAGE_RPC, expectedStatus: 200 },
    async () => popover.getByTestId("filter-picker-apply").click(),
  );
}

test("renders the library filter bar layout", async ({ page }) => {
  await gotoReady(page, "/");

  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("filter-add")).toBeEnabled();
  await expect(chips(page)).toHaveCount(0);
  await expect(clearAll(page)).toHaveCount(0);
  await expect(picker(page)).toHaveCount(0);
  await expectNavVisible(page);

  await switchToTableView(page);
  await expect(bar(page)).toBeVisible();

  await page.getByTestId("filter-add").click();
  await expect(picker(page)).toBeVisible();
  for (const field of FIELDS) {
    await expect(
      picker(page).getByTestId(`filter-field-${field}`),
    ).toBeVisible();
  }
  await expect(page.getByTestId("filter-picker-apply")).toHaveCount(0);
});

test("closes the picker on Escape without adding a clause", async ({
  page,
}) => {
  await gotoReady(page, "/");
  await page.getByTestId("filter-add").click();
  await expect(picker(page)).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(picker(page)).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByTestId("filter-add")).toBeFocused();
});

/** The accessible name of the dialog that holds focus, if any does. */
async function focusedDialog(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() =>
    document.activeElement
      ?.closest('[role="dialog"]')
      ?.getAttribute("aria-label"),
  );
}

test("keeps Tab and Shift+Tab inside the open picker", async ({ page }) => {
  await gotoReady(page, "/");
  await page.getByTestId("filter-add").click();
  await expect(picker(page)).toHaveAttribute("aria-modal", "true");
  await picker(page).getByTestId("filter-field-format").click();
  await expect(picker(page).getByLabel("PDF", { exact: true })).toBeVisible();

  for (const key of ["Tab", "Shift+Tab"]) {
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press(key);
      expect(await focusedDialog(page), `${key} press ${press + 1}`).toBe(
        "Add filter",
      );
    }
  }
});

test("returns focus to Add filter when the picker is cancelled or dismissed", async ({
  page,
}) => {
  await gotoReady(page, "/");
  const add = page.getByTestId("filter-add");

  await add.click();
  await picker(page).getByTestId("filter-field-format").click();
  await picker(page).getByTestId("filter-picker-cancel").click();
  await expect(picker(page)).toHaveCount(0);
  await expect(add).toBeFocused();

  await add.click();
  await page.getByTestId("filter-picker-scrim").click({
    position: { x: 700, y: 600 },
  });
  await expect(picker(page)).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("adds a format clause and narrows the list and count", async ({
  page,
}) => {
  await gotoReady(page, "/");
  const pdfs = expectedSlugs((b) => hasFormat(b, "pdf"));

  const { request } = await addClause(page, {
    field: "format",
    mode: "include",
    picks: [{ label: "PDF" }],
  });

  expect(request.postDataJSON().filters).toEqual({
    clauses: [{ field: "format", mode: "include", values: ["pdf"] }],
  });
  await expect(page.getByTestId("filter-add")).toBeFocused();
  await expect(chips(page)).toHaveCount(1);
  await expect(page.getByTestId("filter-chip-0")).toContainText(
    "Format includes any of PDF",
  );
  await expectShown(page, pdfs);
});

test("matches any of several values in one clause", async ({ page }) => {
  await gotoReady(page, "/");
  const wanted = ["Monica Lam", "Ravi Sethi"];

  await addClause(page, {
    field: "author",
    mode: "include",
    picks: wanted.map((name) => ({ label: name, search: name })),
  });

  await expect(chips(page)).toHaveCount(1);
  await expect(page.getByTestId("filter-chip-0")).toContainText(
    "Author includes any of Monica Lam, Ravi Sethi",
  );
  await expectShown(
    page,
    expectedSlugs((b) => authoredBy(b, ...wanted)),
  );
});

test("combines an exclude clause with an include clause", async ({ page }) => {
  await gotoReady(page, "/");

  await addClause(page, {
    field: "author",
    mode: "include",
    picks: [{ label: "Alfred Aho", search: "Aho" }],
  });
  await addClause(page, {
    field: "author",
    mode: "exclude",
    picks: [{ label: "Jeffrey Ullman", search: "Ullman" }],
  });

  await expect(chips(page)).toHaveCount(2);
  await expect(page.getByTestId("filter-chip-1")).toContainText(
    "Author excludes any of Jeffrey Ullman",
  );
  await expectShown(
    page,
    expectedSlugs(
      (b) => authoredBy(b, "Alfred Aho") && !authoredBy(b, "Jeffrey Ullman"),
    ),
  );
});

test("explains an empty result and clears from it", async ({ page }) => {
  await gotoReady(page, "/");
  const everything = await headerCount(page);
  await addClause(page, {
    field: "author",
    mode: "include",
    picks: [{ label: "Alfred Aho", search: "Aho" }],
  });
  await addClause(page, {
    field: "format",
    mode: "include",
    picks: [{ label: "PDF" }],
  });

  await expectShown(
    page,
    expectedSlugs((b) => authoredBy(b, "Alfred Aho") && hasFormat(b, "pdf")),
  );
  await expect(page.getByText("No books match these filters.")).toBeVisible();
  await expect(page.getByTestId("lib-empty")).toHaveCount(0);
  await recordEmptyLibraryInsertions(page);

  await expectMutation(
    page,
    { method: "POST", url: PAGE_RPC, expectedStatus: 200 },
    async () => page.getByTestId("lib-clear-filters-empty").click(),
  );

  await expect(chips(page)).toHaveCount(0);
  expect(await emptyLibraryInsertions(page)).toBe(0);
  expect(await headerCount(page)).toBe(everything);
});

test("restores the filter after a reload", async ({ page }) => {
  await gotoReady(page, "/");
  const pdfs = expectedSlugs((b) => hasFormat(b, "pdf"));
  await addClause(page, {
    field: "format",
    mode: "include",
    picks: [{ label: "PDF" }],
  });
  await expectShown(page, pdfs);

  await page.reload();
  await waitForHydration(page);

  await expect(page.getByTestId("filter-chip-0")).toContainText(
    "Format includes any of PDF",
  );
  await expectShown(page, pdfs);
});

test("clears every clause in one action", async ({ page }) => {
  await gotoReady(page, "/");
  const everything = await headerCount(page);
  await addClause(page, {
    field: "format",
    mode: "include",
    picks: [{ label: "PDF" }],
  });
  await addClause(page, {
    field: "author",
    mode: "exclude",
    picks: [{ label: "H. G. Wells", search: "Wells" }],
  });
  await expect(chips(page)).toHaveCount(2);
  await expectShown(
    page,
    expectedSlugs((b) => hasFormat(b, "pdf") && !authoredBy(b, "H. G. Wells")),
  );

  await expectMutation(
    page,
    { method: "POST", url: PAGE_RPC, expectedStatus: 200 },
    async () => clearAll(page).click(),
  );

  await expect(chips(page)).toHaveCount(0);
  await expect(clearAll(page)).toHaveCount(0);
  expect(await headerCount(page)).toBe(everything);

  await page.reload();
  await waitForHydration(page);
  await expect(chips(page)).toHaveCount(0);
  expect(await headerCount(page)).toBe(everything);
});

test("keeps the filter bar when the page fetch fails", async ({ page }) => {
  await gotoReady(page, "/");
  await addClause(page, {
    field: "format",
    mode: "include",
    picks: [{ label: "PDF" }],
  });
  await page.route(`**${PAGE_RPC}`, (route) =>
    route.fulfill({ status: 500, body: "boom" }),
  );

  const { request } = await expectMutation(
    page,
    { method: "POST", url: PAGE_RPC, expectedStatus: 500, timeout: 15_000 },
    async () => page.reload(),
  );

  expect(request.postDataJSON().filters.clauses).toHaveLength(1);
  await expect(page.getByTestId("lib-page-error")).toBeVisible();
  await expect(page.getByTestId("filter-chip-0")).toContainText(
    "Format includes any of PDF",
  );
  await expect(clearAll(page)).toBeVisible();

  // The stale filter must not trap the reader: once the server answers again,
  // one Clear all both recovers the list and forgets the saved filter.
  await page.unroute(`**${PAGE_RPC}`);
  await expectMutation(
    page,
    { method: "POST", url: PAGE_RPC, expectedStatus: 200 },
    async () => clearAll(page).click(),
  );
  await expect(page.getByTestId("lib-page-error")).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
  await page.reload();
  await waitForHydration(page);
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByTestId("lib-page-error")).toHaveCount(0);
});
