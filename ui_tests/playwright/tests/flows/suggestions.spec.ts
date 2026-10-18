import { suggestions } from "../contracts/suggestions";
import { mockSuggestion } from "../data/bookDetail";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// F3.3 "Readers also enjoyed" strip. Its state depends on a server-wide Hardcover
// key and a live API call, neither of which CI controls, so each test answers
// `POST /api/rpc/ebook-suggestions` itself rather than seeding cache rows.

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

test.describe("suggestions strip", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show a connect prompt when no hardcover key is configured", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;

    await test.step("open the book with no key configured", async () => {
      await strip.stubNotConfigured();
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    await test.step("check the prompt shows", async () => {
      await expect(strip.root).toBeVisible();
      await expect(strip.notConfigured).toBeVisible();
      await expect(strip.notConfiguredText).toBeVisible();
    });

    // The seeded user is an admin, so the card deep-links to Administration ›
    // Integrations, where the key lives.
    await test.step("check the prompt links to the key's settings", async () => {
      await expect(strip.connectLink).toBeVisible();
      await expect(strip.connectLink).toHaveAttribute(
        "href",
        "/admin?section=integrations",
      );
    });
  });

  test("show a pending placeholder while a resolution is enqueued", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;

    await test.step("open the book with nothing cached yet", async () => {
      await strip.stubPending();
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    await test.step("check the placeholder shows", async () => {
      await expect(strip.pending).toBeVisible();
      await expect(strip.pendingText).toBeVisible();
      await expect(strip.spinner).toBeVisible();
    });
  });

  test("show an empty note when the cache resolved with no matches", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;

    await test.step("open the book with a sticky negative cached", async () => {
      await strip.stubReady([]);
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    await test.step("check the empty note shows", async () => {
      await expect(strip.empty).toBeVisible();
      await expect(strip.emptyText).toBeVisible();
    });
  });

  test("render cached suggestions", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;
    const items = Array.from({ length: 7 }, (_, i) => mockSuggestion(i));

    await test.step("open the book with seven suggestions cached", async () => {
      await strip.stubReady(items);
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    await test.step("check the first card names its book", async () => {
      await expect(strip.firstCard).toContainText(items[0]!.title);
      await expect(strip.firstCard).toContainText(items[0]!.author);
      await expect(strip.firstCard).toContainText("on 1 list");
    });

    // Each card is an outbound link, opened in a new tab without leaking a
    // `window.opener`.
    await test.step("check the card links to Hardcover", async () => {
      await expect(strip.firstCard).toHaveAttribute(
        "href",
        items[0]!.hardcover_url,
      );
      await expect(strip.firstCard).toHaveAttribute("target", "_blank");
      await expect(strip.firstCard).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );
    });
  });

  test("expand the stack with show more", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;
    const items = Array.from({ length: 7 }, (_, i) => mockSuggestion(i));

    await test.step("open the book with seven suggestions cached", async () => {
      await strip.stubReady(items);
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    // The collapsed stack caps at five of the seven.
    await test.step("check the stack shows five", async () => {
      await expect(strip.cards).toHaveCount(5);
      await expect(strip.showMoreButton).toHaveText("Show 2 more");
    });

    await test.step("show the rest", async () => {
      await strip.showMore();
    });

    await test.step("check all seven cards show", async () => {
      await expect(strip.cards).toHaveCount(7);
      await expect(strip.lastCard).toContainText(items[6]!.title);
      await expect(strip.showMoreButton).toHaveCount(0);
    });
  });
});
