import { overrides } from "../contracts/overrides";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// "Fetch Summary" pulls a blurb from the source cascade (Hardcover → Google
// Books → Open Library). The generated fixtures ship no descriptions, so every
// book is "sparse" (< 10 words), which is when the button appears. The cascade
// and the save are stubbed, so CI never touches a live external API.

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// 14 words, so once saved the summary is no longer sparse.
const SUMMARY =
  "A sufficiently long mocked summary with more than ten words to enrich the book.";

test.describe("fetch summary", () => {
  // The target starts sparse with an empty editor field, whatever a prior run
  // or manual test left behind.
  test.beforeAll(
    "seed the library with the target sparse",
    async ({ request, overridesRequests }) => {
      await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      await expect(
        await overridesRequests.deleteOverrides(uuid),
        "clear the overrides",
      ).toBeOK();
    },
  );

  test("fetch a summary from the detail page and hide the button", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { summary } = bookDetailPage;

    await test.step("open the book with a sparse summary", async () => {
      await bookDetailPage.goto(uuid);
      await expect(summary.fetchButton).toBeVisible();
    });

    await test.step("fetch the summary", async () => {
      await summary.stubSummaryFound(SUMMARY);
      await expectMutation(
        overrides.save({ uuid, overrides: { description: SUMMARY } }),
        () => summary.fetchSummary(),
      );
    });

    await test.step("check the summary shows and the button hides", async () => {
      await expect(summary.description).toContainText(SUMMARY);
      await expect(summary.fetchButton).toBeHidden();
    });
  });

  // `.bdmq-desc` clamps to five lines, and before #2290 the rest could not be
  // read.
  test("expand a clamped description and collapse it again", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { summary } = bookDetailPage;
    const long = `${"Every clause here exists only to push this blurb past the clamp. ".repeat(8)}End.`;

    await test.step("fetch a long summary", async () => {
      await bookDetailPage.goto(uuid);
      await summary.stubSummaryFound(long);
      await expectMutation(overrides.save(), () => summary.fetchSummary());
    });

    await test.step("check the description is clamped", async () => {
      await expect(summary.expandToggle).toBeVisible();
      await expect(summary.expandToggle).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(summary.description).not.toHaveClass(/is-open/);
    });

    // Keyboard-reachable, per AC2: focus the toggle and press Enter.
    await test.step("expand it from the keyboard", async () => {
      await summary.focusExpandToggle();
      await expect(summary.expandToggle).toBeFocused();
      await summary.pressExpandToggle();
      await expect(summary.expandToggle).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(summary.description).toHaveClass(/is-open/);
      await expect.poll(() => summary.showsWholeDescription()).toBe(true);
    });

    await test.step("collapse it again", async () => {
      await summary.pressExpandToggle();
      await expect(summary.expandToggle).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(summary.description).not.toHaveClass(/is-open/);
    });
  });

  test("offer no expand control for a description that fits", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { summary } = bookDetailPage;

    await test.step("fetch a short summary", async () => {
      await bookDetailPage.goto(uuid);
      await summary.stubSummaryFound(SUMMARY);
      await expectMutation(overrides.save(), () => summary.fetchSummary());
    });

    await test.step("check there is nothing to expand", async () => {
      await expect(summary.description).toContainText(SUMMARY);
      await expect(summary.expandToggle).toHaveCount(0);
    });
  });
});
