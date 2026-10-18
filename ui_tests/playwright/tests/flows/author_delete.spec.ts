import { authors } from "../contracts/authors";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

// A confirmed delete blocklists the author's name for good, so each test picks
// a different fixture author and the one that confirms puts its author back
// (`deletedAuthors`) to leave the shared library intact.

test.describe.configure({ mode: "serial" });

test.beforeAll("seed the library", async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test.describe("delete an author", () => {
  test("show the Delete author button to an admin", async ({
    authorPage,
    authorId,
  }) => {
    await test.step("open an author", async () => {
      // A fixture-only author, so a failing test never wipes a real one.
      await authorPage.goto(await authorId("Hedy Lamarr"));
    });

    await test.step("check the ⋯ menu offers Delete", async () => {
      await authorPage.openMoreMenu();
      await expect(authorPage.deleteButton).toBeVisible();
    });
  });

  test("open the confirmation with the author name and book count", async ({
    authorPage,
    authorId,
  }) => {
    const name = "Sophie Germain";

    await test.step("click Delete", async () => {
      await authorPage.goto(await authorId(name));
      await authorPage.openDeleteDialog();
    });

    await test.step("check the dialog names the author and the books", async () => {
      await expect(authorPage.deleteDialog).toBeVisible();
      await expect(authorPage.deleteDialog).toContainText(name);
      await expect(authorPage.deleteDialog).toContainText(
        /un-link the author from \d+ books?/,
      );
    });

    await test.step("cancel", async () => {
      await authorPage.cancelDelete();
      await expect(authorPage.deleteDialog).toHaveCount(0);
    });
  });

  test("delete an author and return to the authors index", async ({
    authorPage,
    authorsIndexPage,
    authorId,
    linkedAuthorNames,
    deletedAuthors,
    expectMutation,
  }) => {
    // A single-book author, so the delete touches exactly one book.
    const name = "Joan Clarke";

    await test.step("open the confirmation", async () => {
      await authorPage.goto(await authorId(name));
      await authorPage.openDeleteDialog();
      await expect(authorPage.deleteDialog).toBeVisible();
    });

    await test.step("confirm the delete", async () => {
      await expectMutation(authors.delete(), () => authorPage.confirmDelete());
      // Registered only once the delete landed, so a failed one restores nothing.
      deletedAuthors.add(name);
    });

    await test.step("check the authors index opens", async () => {
      await authorsIndexPage.assertDisplayed();
      // The list stays mounted across the redirect, so it drops the row itself.
      await expect(authorsIndexPage.card(name)).toHaveCount(0);
    });

    await test.step("check the library no longer links the author", async () => {
      expect(await linkedAuthorNames()).not.toContain(name);
    });
  });

  test("surface an error and stay on the page when the delete fails", async ({
    authorPage,
    authorId,
    expectMutation,
  }) => {
    const id = await authorId("Karen Sparck Jones");

    await test.step("open the confirmation", async () => {
      await authorPage.goto(id);
      await authorPage.openDeleteDialog();
    });

    await test.step("confirm a delete that fails", async () => {
      await authorPage.forceServerError(authors.delete());
      await expectMutation(failing(authors.delete()), () =>
        authorPage.confirmDelete(),
      );
    });

    await test.step("check the dialog stays open with the error", async () => {
      await expect(authorPage.deleteDialog).toBeVisible();
      await expect(authorPage.deleteErrorMessage).toBeVisible();
      await authorPage.assertDisplayedFor(`/authors/${id}`);
    });
  });
});
