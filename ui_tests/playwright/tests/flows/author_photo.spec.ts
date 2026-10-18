import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Every test writes the cached photo of the same author ("Ada Lovelace"), so
// they run in turn. The discovery specs read that author, which is why only
// the photo is touched and never the author row.
test.describe.configure({ mode: "serial" });

test.beforeAll("seed the library", async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test.describe("author photo", () => {
  test("show the letter avatar when no photo is uploaded", async ({
    authorPage,
    authorId,
  }) => {
    await test.step("open an author without a photo", async () => {
      await authorPage.goto(await authorId("Ada Lovelace"));
    });

    await test.step("check the initial shows and no photo does", async () => {
      await expect(authorPage.letterAvatar).toBeVisible();
      await expect(authorPage.letterAvatar).toHaveText("A");
      await expect(authorPage.photoAvatar).toHaveCount(0);
    });
  });

  test("swap the letter avatar for an uploaded photo", async ({
    authorPage,
    authorId,
    uploadAuthorPhoto,
  }) => {
    const id = await authorId("Ada Lovelace");

    await test.step("upload a photo and reload until it shows", async () => {
      // One transient photo error drops the image to the letter until a fresh mount,
      // and a queued lookup can overwrite the upload, so retry both.
      await expect(async () => {
        await uploadAuthorPhoto(id);
        await authorPage.goto(id);
        await expect(authorPage.photoAvatar).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
    });

    await test.step("check the photo is the author's", async () => {
      await expect(authorPage.photoAvatar).toHaveAttribute(
        "src",
        `/api/authors/${id}/photo`,
      );
      // `.disc-avatar` stays as the outer circle when `has_photo` flips (#1839,
      // rule 07), so only the letter inside it goes.
      await expect(authorPage.letterAvatar).not.toContainText("A");
    });

    await test.step("check the image bytes load", async () => {
      // Fetched from the page so its cookies ride along; the <img> request can
      // finish before a response listener is registered.
      expect(await authorPage.photoStatus(id)).toBe(200);
    });
  });

  test("bring the letter back when the photo is deleted", async ({
    authorPage,
    authorsRequests,
    authorId,
    uploadAuthorPhoto,
  }) => {
    const id = await authorId("Ada Lovelace");

    await test.step("upload the photo and delete it as the admin", async () => {
      await uploadAuthorPhoto(id);
      const deleted = await authorsRequests.deletePhoto(id);
      expect(deleted.status(), "delete the photo").toBe(204);
    });

    await test.step("open the author", async () => {
      await authorPage.goto(id);
    });

    await test.step("check the letter is back and the photo gone", async () => {
      await expect(authorPage.letterAvatar).toBeVisible();
      await expect(authorPage.photoAvatar).toHaveCount(0);
    });
  });
});
