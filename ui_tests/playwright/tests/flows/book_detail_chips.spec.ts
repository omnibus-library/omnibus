import { overrides } from "../contracts/overrides";
import type { EbookDetail } from "../data/ebooks";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-glacier")!;

test.describe("book detail chip editors", () => {
  // The editors write overrides on the reserved `standalone-glacier`, so the
  // file runs in order and each test clears them first.
  test.describe.configure({ mode: "default" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  // The teardown clears them again, so the book also ends the run chip-free.
  test.beforeEach(
    "clear the book's overrides",
    async ({ request, overridesRequests, overriddenBookUuids }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);
      const cleared = await overridesRequests.deleteOverrides(uuid);
      expect(cleared.status(), "cleanup revert must succeed").toBe(200);
    },
  );

  test("show the chip editor layout", async ({ bookDetailPage, request }) => {
    const { genreChips, tagChips } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // Both pills render with no genres or tags: they are the way in to the
    // editors, not decoration on existing chips.
    await test.step("check the nav and both pills show", async () => {
      await bookDetailPage.topNav.assertDisplayed();
      await expect(genreChips.addButton).toHaveText("+ genres");
      await expect(tagChips.addButton).toHaveText("+ tags");
    });

    // #2257: genres and tags are separate labelled rows, and each pill sits
    // in the row it adds to.
    await test.step("check each pill sits in its own row", async () => {
      await expect(genreChips.root).toContainText("Genres");
      await expect(tagChips.root).toContainText("Tags");
      await expect(genreChips.addButton).toBeVisible();
      await expect(tagChips.addButton).toBeVisible();
      await expect(genreChips.otherAddButton).toHaveCount(0);
      await expect(tagChips.otherAddButton).toHaveCount(0);
    });
  });

  test("add a tag from the hero pill", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const { tagChips } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("open the tag editor", async () => {
      await tagChips.openEditor();
      await expect(tagChips.input).toBeVisible();
      await expect(tagChips.input).toHaveAttribute("placeholder", "+ add tag…");
    });

    await test.step("add a tag", async () => {
      await expectMutation(
        overrides.save({ uuid, overrides: { subjects: ["Alpine Computing"] } }),
        () => tagChips.addChip("Alpine Computing"),
      );
      await expect(tagChips.editorPanel).toContainText("Alpine Computing");
    });

    await test.step("close the editor", async () => {
      await tagChips.closeEditor();
      await expect(tagChips.input).toHaveCount(0);
      await expect(tagChips.list).toContainText("Alpine Computing");
      await expect(tagChips.list).toContainText("+ tags");
    });

    // The override is server state, so a fresh load proves the save stuck.
    await test.step("reopen the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the tag persisted", async () => {
      await expect(tagChips.list).toContainText("Alpine Computing");
    });
  });

  test("show a saved tag on the book", async ({
    bookDetailPage,
    request,
    overridesRequests,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("save a tag through the api", async () => {
      const saved = await overridesRequests.postOverrides(uuid, {
        subjects: ["Alpine Computing"],
      });
      expect(saved.status(), "seed the tag").toBe(200);
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the tag shows", async () => {
      await expect(bookDetailPage.tagChips.list).toContainText(
        "Alpine Computing",
      );
    });
  });

  test("suggest tags when the tag editor opens", async ({
    bookDetailPage,
    request,
    overridesRequests,
  }) => {
    const { tagChips } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("save a tag through the api", async () => {
      const saved = await overridesRequests.postOverrides(uuid, {
        subjects: ["Alpine Computing"],
      });
      expect(saved.status(), "seed the tag").toBe(200);
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // Tags already on the book leave the pool, so the dropdown's header is
    // what shows the editor opened with suggestions wired up.
    await test.step("open the tag editor", async () => {
      await tagChips.openEditor();
      await expect(tagChips.suggestionsList).toContainText("ADD TAG");
    });
  });

  test("add a genre from the hero pill", async ({
    bookDetailPage,
    request,
    ebooksRequests,
    expectMutation,
  }) => {
    const { genreChips } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("open the genre editor", async () => {
      await genreChips.openEditor();
      await expect(genreChips.input).toHaveAttribute(
        "placeholder",
        "+ add genre…",
      );
    });

    await test.step("add a genre", async () => {
      await expectMutation(
        overrides.save({ uuid, overrides: { genres: ["Field Notes"] } }),
        () => genreChips.addChip("Field Notes"),
      );
      await genreChips.closeEditor();
      await expect(genreChips.list).toContainText("Field Notes");
      await expect(genreChips.list).toContainText("+ genres");
    });

    await test.step("check the server stored the genre alone", async () => {
      const response = await ebooksRequests.getEbook(uuid);
      await expect(response).toBeOK();
      const book: EbookDetail = await response.json();
      expect(book.genres).toEqual(["Field Notes"]);
      expect(book.subjects).toEqual([]);
    });
  });

  test("drop a tag whose save fails", async ({
    bookDetailPage,
    request,
    expectMutation,
  }) => {
    const { tagChips } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const unsaved = overrides.save({
      uuid,
      overrides: { subjects: ["Never Saved"] },
    });

    await test.step("open the book while saves fail", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.forceServerError(unsaved);
    });

    await test.step("add a tag", async () => {
      await tagChips.openEditor();
      await expectMutation(failing(unsaved), () =>
        tagChips.addChip("Never Saved"),
      );
    });

    // A rejected save resyncs the editor from the book, so the chip clears
    // without a reload.
    await test.step("check the editor dropped the tag", async () => {
      await expect(tagChips.editorPanel).not.toContainText("Never Saved");
    });

    await test.step("stop failing saves", async () => {
      await bookDetailPage.stopForcingServerError(unsaved);
    });

    await test.step("check nothing was saved", async () => {
      await bookDetailPage.goto(uuid);
      await expect(tagChips.list).not.toContainText("Never Saved");
    });
  });
});
