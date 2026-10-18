// Book-detail hero chip editors: the admin-only "+ genres" / "+ tags" pills
// that swap the hero's chip lists for the shared ChipEditor and save a
// genres/subjects override on every add.
//
// Both editors write `metadata_overrides` on the target, which is globally
// visible and flips `has_override`, so this file owns `standalone-glacier`
// outright (see the fixture comment in `tests/fixtures/epubs.ts`).

import { overrides } from "../contracts/overrides";
import type { BookRecord } from "../data/bookDetail";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-glacier")!;

test.describe("book detail chip editors", () => {
  // Every test writes and clears overrides on the same reserved book, so under
  // `fullyParallel` one test's clear would wipe another's just-saved chip.
  test.describe.configure({ mode: "default" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  // The teardown clears them again, so the book also ends the run chip-free.
  test.beforeEach(
    "start the reserved book chip-free",
    async ({ request, overridesRequests, overriddenBookUuids }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);
      await expect(
        await overridesRequests.deleteOverrides(uuid),
        "clear the overrides",
      ).toBeOK();
    },
  );

  test("show the chip editor layout", async ({ bookDetailPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { heroChips } = bookDetailPage;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the nav shows", async () => {
      await bookDetailPage.topNav.assertDisplayed();
    });

    // The pills are the entry point, not a decoration on existing chips, so
    // both render although the book carries no genres or tags.
    await test.step("check both pills show", async () => {
      await expect(heroChips.addGenresPill).toHaveText("+ genres");
      await expect(heroChips.addTagsPill).toHaveText("+ tags");
    });

    // #2257: each pill sits inside the row it adds to, not trailing the other
    // set's chips.
    await test.step("check each row holds its own pill", async () => {
      await expect(heroChips.genreRow).toContainText("Genres");
      await expect(heroChips.tagRow).toContainText("Tags");
      await expect(heroChips.genreRowGenresPill).toBeVisible();
      await expect(heroChips.tagRowTagsPill).toBeVisible();
      await expect(heroChips.genreRowTagsPill).toHaveCount(0);
      await expect(heroChips.tagRowGenresPill).toHaveCount(0);
    });
  });

  test("add a tag from the hero pill", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { heroChips } = bookDetailPage;

    await test.step("open the tag editor", async () => {
      await bookDetailPage.goto(uuid);
      await heroChips.openTagEditor();
      await expect(heroChips.tagsInput).toBeVisible();
      await expect(heroChips.tagsInput).toHaveAttribute(
        "placeholder",
        "+ add tag…",
      );
    });

    await test.step("save a tag", async () => {
      await expectMutation(overrides.save(), () =>
        heroChips.addTag("Alpine Computing"),
      );
      await expect(heroChips.tagsEditor).toContainText("Alpine Computing");
    });

    await test.step("leave the editor", async () => {
      await heroChips.closeTagEditor();
      await expect(heroChips.tagsInput).toHaveCount(0);
      await expect(heroChips.tagList).toContainText("Alpine Computing");
      await expect(heroChips.tagList).toContainText("+ tags");
    });

    // The override is server state, not UI state.
    await test.step("check the tag survives a reload", async () => {
      await bookDetailPage.goto(uuid);
      await expect(heroChips.tagList).toContainText("Alpine Computing");
    });

    // Assigned values leave the pool, so the dropdown's header is what proves
    // the editor reopened with it wired up.
    await test.step("reopen the editor and check it suggests", async () => {
      await heroChips.openTagEditor();
      await expect(heroChips.tagSuggestions).toContainText("ADD TAG");
    });
  });

  test("add a genre from the hero pill", async ({
    bookDetailPage,
    ebooksRequests,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { heroChips } = bookDetailPage;

    await test.step("open the genre editor", async () => {
      await bookDetailPage.goto(uuid);
      await heroChips.openGenreEditor();
      await expect(heroChips.genresInput).toHaveAttribute(
        "placeholder",
        "+ add genre…",
      );
    });

    await test.step("save a genre", async () => {
      await expectMutation(overrides.save(), () =>
        heroChips.addGenre("Field Notes"),
      );
    });

    await test.step("leave the editor", async () => {
      await heroChips.closeGenreEditor();
      await expect(heroChips.genreList).toContainText("Field Notes");
      await expect(heroChips.genreList).toContainText("+ genres");
    });

    // A genres override must not write a `subjects` one alongside it.
    await test.step("check only the genres override was saved", async () => {
      const response = await ebooksRequests.getEbook(uuid);
      await expect(response).toBeOK();
      const book: BookRecord = await response.json();
      expect(book.genres).toEqual(["Field Notes"]);
      expect(book.subjects).toEqual([]);
    });
  });

  test("keep a tag out when its save fails", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const { heroChips } = bookDetailPage;

    await test.step("open the tag editor with saves failing", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.forceServerError(overrides.save());
      await heroChips.openTagEditor();
    });

    await test.step("save a tag", async () => {
      await expectMutation(failing(overrides.save()), () =>
        heroChips.addTag("Never Saved"),
      );
    });

    // A rejected save resyncs the editor from the canonical book, so the
    // optimistic chip clears in place.
    await test.step("check the chip clears without a reload", async () => {
      await expect(heroChips.tagsEditor).not.toContainText("Never Saved");
    });

    await test.step("check nothing was saved", async () => {
      await bookDetailPage.goto(uuid);
      await expect(heroChips.tagList).not.toContainText("Never Saved");
    });
  });
});
