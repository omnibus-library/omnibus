import type { APIRequestContext } from "@playwright/test";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { fetchBookIdByTitle } from "../utils/ebooks";
import { gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";
import { selectShelfInGallery, withManualShelf } from "../utils/shelves";

// Seed before all tests so the indexer has populated authors/series/tags.
test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

// ---------------------------------------------------------------------------
// Helpers — resolve IDs via the RPC layer so tests don't hardcode DB ids.
// ---------------------------------------------------------------------------

async function fetchAuthorIdByName(
  request: APIRequestContext,
  name: string,
): Promise<number> {
  // GET /api/rpc/ebooks (same payload the landing page uses) and scan
  // each book's creators for the named author.
  const resp = await request.get("/api/rpc/ebooks");
  expect(resp.status(), "GET /api/rpc/ebooks failed").toBe(200);
  const body = (await resp.json()) as {
    books: { creators: { name: string; id: number | null }[] }[];
  };
  for (const book of body.books) {
    const match = book.creators.find((c) => c.name === name);
    if (match?.id) return match.id;
  }
  throw new Error(`no indexed author named ${JSON.stringify(name)}`);
}

async function fetchSeriesIdByName(
  request: APIRequestContext,
  name: string,
): Promise<number> {
  // `EbookMetadata` carries `series_id` directly, so we can resolve the
  // series ID from any book in the series via the same `/api/rpc/ebooks`
  // payload the landing page consumes.
  const resp = await request.get("/api/rpc/ebooks");
  expect(resp.status(), "GET /api/rpc/ebooks failed").toBe(200);
  const body = (await resp.json()) as {
    books: { series: string | null; series_id: number | null }[];
  };
  const match = body.books.find(
    (b) => b.series === name && b.series_id != null,
  );
  if (!match?.series_id) {
    throw new Error(`no indexed series named ${JSON.stringify(name)}`);
  }
  return match.series_id;
}

// ---------------------------------------------------------------------------
// Author page
// ---------------------------------------------------------------------------

test("renders the author page layout", async ({ page, request }) => {
  const authorName = "Ada Lovelace";
  const authorId = await fetchAuthorIdByName(request, authorName);

  await gotoReady(page, `/authors/${authorId}`);

  // The pane sits beside the list, whose title is the page's h1.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Authors",
  );
  await expect(page.getByTestId("author-name")).toHaveText(authorName);

  // Book count, the reader's progress strip, and the library shortcut.
  await expect(page.getByTestId("author-meta")).toContainText("book");
  await expect(page.getByTestId("author-reading")).toBeVisible();
  await expect(page.getByTestId("author-show-in-library")).toBeVisible();
});

test("author page shows books by the author", async ({ page, request }) => {
  // Niklaus Wirth has 4 books in the Code Quartet
  const authorName = "Niklaus Wirth";
  const authorId = await fetchAuthorIdByName(request, authorName);

  await gotoReady(page, `/authors/${authorId}`);

  await expect(page.getByTestId("author-name")).toContainText("Wirth");

  // Should show the series section for "Code Quartet"
  await expect(page.getByText("Code Quartet")).toBeVisible();

  // At least the first book title should be visible
  await expect(page.getByText("Quartet I: Lexer")).toBeVisible();
});

test("author page shows the author's books in the library", async ({
  page,
  request,
}) => {
  // A fresh browser context has never saved library prefs, which is the case
  // a saved filter alone can't reach: the filter must be handed over.
  const authorId = await fetchAuthorIdByName(request, "Niklaus Wirth");
  await gotoReady(page, `/authors/${authorId}`);

  // The library's first page asks for this author's books alone.
  const filtered = page.waitForResponse(
    (res) =>
      res.url().includes("/api/rpc/ebooks/page") &&
      (res.request().postData() ?? "").includes("Niklaus Wirth"),
  );
  await page.getByTestId("author-show-in-library").click();
  await filtered;

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("filter-chip-0")).toContainText(
    "Niklaus Wirth",
  );

  // Saved once the library answered, so it outlives a reload.
  await gotoReady(page, "/");
  await expect(page.getByTestId("filter-chip-0")).toContainText(
    "Niklaus Wirth",
  );
});

test("author page leaves a selected shelf to show the author's books", async ({
  page,
  request,
}) => {
  // The landing restores its last shelf pick, which would otherwise narrow
  // the author's books to that shelf's (here, none of them).
  const authorId = await fetchAuthorIdByName(request, "Niklaus Wirth");
  await withManualShelf(request, "Show in library", async (shelf) => {
    await gotoReady(page, "/");
    await selectShelfInGallery(page, shelf.id, shelf.name);

    await gotoReady(page, `/authors/${authorId}`);
    await page.getByTestId("author-show-in-library").click();

    await expect(page.getByTestId("lib-section-title")).toContainText(
      "All Books",
    );
    await expect(page.getByTestId("filter-chip-0")).toContainText(
      "Niklaus Wirth",
    );
  });
});

test("author series section heading links to the series page", async ({
  page,
  request,
}) => {
  // Niklaus Wirth's four books all belong to "Code Quartet", so the author
  // page renders a single series shelf whose "Series page" link opens
  // /series/:id.
  const authorId = await fetchAuthorIdByName(request, "Niklaus Wirth");
  await gotoReady(page, `/authors/${authorId}`);

  const seriesLink = page.getByRole("link", {
    name: "Code Quartet series page",
  });
  await expect(seriesLink).toBeVisible();
  await seriesLink.click();

  await expect(page).toHaveURL(/\/series\/\d+$/);
  // Destination renders: series page H1 + book-count label.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Code Quartet",
  );
  await expect(page.getByText(/in library/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Book detail → series
// ---------------------------------------------------------------------------

test("book detail shelf stop links to the series page", async ({
  page,
  request,
}) => {
  // `beta` ("Beta in the Series") is Pioneers #1, so the marquee Shelf stop
  // renders the whole series as covers with a dedicated "series page →"
  // link under the shelf (the Home kicker's series link is covered by
  // book_detail.spec.ts — this test owns the shelf-stop affordance).
  const beta = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;
  const id = await fetchBookIdByTitle(request, beta.title);
  await gotoReady(page, `/books/${id}`);

  await expect(page.getByTestId("bdmq-series-shelf")).toBeVisible();
  const shelfLink = page.getByRole("link", { name: /series page/ });
  await shelfLink.click();

  await expect(page).toHaveURL(/\/series\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Pioneers",
  );
  await expect(page.getByText(/in library/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Series page
// ---------------------------------------------------------------------------

test("renders the series page layout", async ({ page, request }) => {
  const seriesName = "Pioneers";
  const seriesId = await fetchSeriesIdByName(request, seriesName);

  await gotoReady(page, `/series/${seriesId}`);

  // H1 contains the series name
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Book count label is visible
  await expect(page.getByText(/in library/)).toBeVisible();
});

test("series page shows books in order", async ({ page, request }) => {
  const seriesName = "Pioneers";
  const seriesId = await fetchSeriesIdByName(request, seriesName);

  await gotoReady(page, `/series/${seriesId}`);

  // Should have multiple book cards — "Pioneers" has 5 books in fixtures
  const cards = page.locator("article.series-card");
  await expect(cards).toHaveCount(5);

  // First book should show "Book #1"
  await expect(cards.first().getByText("Book #1")).toBeVisible();
});

test("clicking a non-linked area of a series book card navigates to the book", async ({
  page,
  request,
}) => {
  const seriesName = "Pioneers";
  const seriesId = await fetchSeriesIdByName(request, seriesName);

  await gotoReady(page, `/series/${seriesId}`);

  // "Book #1" is plain label text, not the cover or title link, and it's a
  // sibling (not an ancestor/descendant) of the stretched-link overlay — so
  // Playwright's actionability check correctly refuses a direct `.click()`
  // on the label itself (a different element receives the pointer event).
  // Click through the card, an ancestor of the overlay, at the label's
  // position instead, so the browser's real hit-testing routes the click to
  // the full-card overlay.
  const firstCard = page.locator("article.series-card").first();
  const label = firstCard.getByText("Book #1");
  await expect(label).toBeVisible();

  const cardBox = await firstCard.boundingBox();
  const labelBox = await label.boundingBox();
  if (!cardBox || !labelBox) {
    throw new Error("expected the card and label to have a bounding box");
  }
  await firstCard.click({
    position: {
      x: labelBox.x + labelBox.width / 2 - cardBox.x,
      y: labelBox.y + labelBox.height / 2 - cardBox.y,
    },
  });

  await expect(page).toHaveURL(/\/books\/[^/]+$/);
});
