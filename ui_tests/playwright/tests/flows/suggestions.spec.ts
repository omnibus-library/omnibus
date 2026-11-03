import { suggestions } from "../contracts/suggestions";
import { mockSuggestion } from "../data/bookDetail";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// F3.3 "Readers also enjoyed" strip. Its state depends on a server-wide Hardcover
// key and a live API call, neither of which CI controls, so each test answers
// `GET /api/ebooks/{uuid}/suggestions` itself rather than seeding cache rows.

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

  test("show an unavailable note when the lookup failed", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;

    await test.step("open the book whose lookup failed", async () => {
      await strip.stubUnavailable();
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    await test.step("check the note shows in place of the spinner", async () => {
      await expect(strip.unavailable).toBeVisible();
      await expect(strip.unavailableText).toBeVisible();
      await expect(strip.pending).toHaveCount(0);
      await expect(strip.spinner).toHaveCount(0);
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

  // The React page draws a card's title and author but drops its Hardcover
  // list count, which the payload still carries.
  test.fixme("show how many lists each suggestion is on", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const strip = bookDetailPage.suggestions;

    await test.step("open the book with one suggestion cached", async () => {
      await strip.stubReady([mockSuggestion(0)]);
      await expectMutation(suggestions.fetch(), () =>
        bookDetailPage.goto(uuid),
      );
    });

    await test.step("check the card counts its lists", async () => {
      await expect(strip.firstCard).toContainText("on 1 list");
    });
  });

  // The strip is one row that scrolls sideways, so every card is drawn.
  test("show every cached suggestion in the row", async ({
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

    await test.step("check all seven cards show", async () => {
      await expect(strip.cards).toHaveCount(7);
      await expect(strip.lastCard).toContainText(items[6]!.title);
    });
  });
});
