import { existsSync } from "node:fs";
import { books } from "../contracts/books";
import { buildExternalBook } from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Every destructive test deletes a book it created itself; a committed fixture
// is only used read-only, or with the delete intercepted, so no flow loses a file.
test.describe.configure({ mode: "serial" });

const FIXTURE = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;

test.describe("delete book files", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    test.setTimeout(120_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the delete files layout", async ({ request, bookDetailPage }) => {
    const { deleteFilesDialog: dialog } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, FIXTURE.title);

    await test.step("open the ebook", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the rail offers an admin delete", async () => {
      await bookDetailPage.assertDisplayed();
      await bookDetailPage.topNav.assertDisplayed();
      await expect(bookDetailPage.editMetadataLink).toBeVisible();
      await expect(dialog.openButton).toBeVisible();
    });

    await test.step("open the dialog", async () => {
      await dialog.open();
      await expect(dialog.dialog).toBeVisible();
      await expect(dialog.selectAllBox).toBeVisible();
      // One checkbox row per file, and nothing is selected until the user picks.
      await expect(dialog.fileCheckboxes).toHaveCount(1);
      await expect(dialog.continueButton).toBeDisabled();
    });

    await test.step("cancel the dialog", async () => {
      await dialog.cancel();
      await expect(dialog.dialog).not.toBeVisible();
    });
  });

  test("warn that deleting every file also removes the book", async ({
    request,
    bookDetailPage,
    bookExists,
  }) => {
    const { deleteFilesDialog: dialog } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, FIXTURE.title);

    await test.step("select every file and continue", async () => {
      await bookDetailPage.goto(uuid);
      await dialog.open();
      await dialog.selectAll();
      await dialog.continueToConfirm();
    });

    await test.step("check the confirm warns the book goes too", async () => {
      await expect(dialog.confirmCopy).toContainText(
        "removed from your library entirely",
      );
    });

    // Back returns to the checklist with the selection intact.
    await test.step("go back, then cancel", async () => {
      await dialog.back();
      await expect(dialog.selectAllBox).toBeVisible();
      await dialog.cancel();
    });

    await test.step("check the book is untouched", async () => {
      expect(await bookExists(uuid)).toBe(true);
    });
  });

  test("keep the book when deleting its files fails", async ({
    request,
    bookDetailPage,
    bookExists,
    expectMutation,
  }) => {
    const { deleteFilesDialog: dialog } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, FIXTURE.title);

    await test.step("select every file while deletes fail", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.forceServerError(books.deleteFiles());
      await dialog.open();
      await dialog.selectAll();
      await dialog.continueToConfirm();
    });

    await test.step("confirm the delete", async () => {
      await expectMutation(failing(books.deleteFiles()), () =>
        dialog.confirmDelete(),
      );
    });

    await test.step("check the dialog shows the error and the book stays", async () => {
      await expect(dialog.errorAlert).toBeVisible();
      await dialog.cancel();
      expect(await bookExists(uuid)).toBe(true);
    });
  });

  test("delete an uploaded ebook with its record and file on disk", async ({
    bookDetailPage,
    libraryPage,
    uploadedEbook,
    bookExists,
    expectMutation,
  }) => {
    test.slow();
    const { deleteFilesDialog: dialog } = bookDetailPage;

    await test.step("select every file of the uploaded book", async () => {
      await bookDetailPage.goto(uploadedEbook.uuid);
      await dialog.open();
      await dialog.selectAll();
      await dialog.continueToConfirm();
    });

    await test.step("confirm the delete", async () => {
      await expectMutation(books.deleteFiles(), () => dialog.confirmDelete());
    });

    // The last file gone takes the book with it, and the page back to the library.
    await test.step("check the book and its file are gone", async () => {
      await libraryPage.assertDisplayed();
      expect(await bookExists(uploadedEbook.uuid)).toBe(false);
      // The canonical `<author>/<title>/` folders are pruned with the file.
      expect(existsSync(uploadedEbook.folder)).toBe(false);
    });
  });

  test("delete a physical-only book by removing its copy", async ({
    bookDetailPage,
    libraryPage,
    scanRequests,
    createdBookUuids,
    bookExists,
    expectMutation,
  }) => {
    const { deleteFilesDialog: dialog } = bookDetailPage;

    const uuid =
      await test.step("add a book with a copy and no files", async () => {
        const added = await scanRequests.postPhysicalOnly(buildExternalBook());
        await expect(added).toBeOK();
        const { book_uuid }: { book_uuid: string } = await added.json();
        createdBookUuids.add(book_uuid);
        return book_uuid;
      });

    // The control stays as this record's only removal, but no longer promises
    // to delete files it hasn't got (#2471).
    await test.step("open the delete dialog", async () => {
      await bookDetailPage.goto(uuid);
      await expect(dialog.openButton).toHaveText(/Delete record/);
      await dialog.open();
    });

    // No files, but the physical copy is a deletable item in its own section.
    await test.step("select the copy", async () => {
      await expect(dialog.dialog).toContainText("PHYSICAL COPIES");
      await expect(dialog.dialog).toContainText("no file on disk");
      await dialog.selectAll();
      await expect(dialog.continueButton).toHaveText(/Delete 1 item/);
      await dialog.continueToConfirm();
    });

    // Every item selected means the record goes.
    await test.step("confirm the delete", async () => {
      await expect(dialog.confirmCopy).toContainText(
        "removed from your library entirely",
      );
      await expectMutation(books.deleteFiles(), () => dialog.confirmDelete());
      createdBookUuids.delete(uuid);
    });

    await test.step("check the record is gone", async () => {
      await libraryPage.assertDisplayed();
      expect(await bookExists(uuid)).toBe(false);
    });
  });
});
