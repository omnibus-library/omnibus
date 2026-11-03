import { covers } from "../contracts/covers";
import { overrides } from "../contracts/overrides";
import { TINY_PNG } from "../data/covers";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Alpha: standalone, single author, has cover.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// The paste-a-URL tests stub every write, since the server's SSRF gate cannot reach a test origin.
const PASTED_COVER_URL = "https://images.example.com/custom-cover.jpg";

test.describe("metadata edit sheet", () => {
  // Every test reads or writes override state on the same book, so they run one at a time.
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the metadata edit sheet layout", async ({
    metadataEditPage,
    request,
  }) => {
    const { form } = metadataEditPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the edit sheet", async () => {
      await metadataEditPage.goto(uuid);
    });

    await test.step("check the sheet, its nav and its header", async () => {
      await metadataEditPage.assertDisplayed();
      await metadataEditPage.topNav.assertDisplayed();
      await expect(metadataEditPage.bookHeading(TARGET.title)).toBeVisible();
      await expect(metadataEditPage.closeButton).toBeVisible();
    });

    await test.step("check the form is pre-populated", async () => {
      await expect(form.titleField).toBeVisible();
      await expect(form.titleField).toHaveValue(TARGET.title);
      await expect(form.authorChip(TARGET.authors[0]!)).toBeVisible();
    });

    // Nothing is unsaved yet, so there is nothing to discard.
    await test.step("check the save bar", async () => {
      await expect(form.saveButton).toBeVisible();
      await expect(form.saveState).toHaveText("No changes");
      await expect(form.discardButton).toHaveText("Discard edits");
      await expect(form.discardButton).toBeDisabled();
    });

    await test.step("check the cover URL field on the artwork tab", async () => {
      await form.openArtwork();
      await expect(form.coverUrlField).toBeVisible();
      await expect(form.coverUrlField).toHaveAttribute("type", "url");
      await expect(form.applyCoverUrlButton).toBeDisabled();
    });
  });

  test("open the edit sheet from the book detail page", async ({
    bookDetailPage,
    metadataEditPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    // The link sits under the Details list on the Files & Details tab.
    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.openTab("Files & Details");
      await expect(bookDetailPage.editMetadataLink).toBeVisible();
    });

    await test.step("follow the edit metadata link", async () => {
      await bookDetailPage.openEditMetadata();
      await metadataEditPage.assertDisplayedFor(uuid);
    });
  });

  test.describe("overrides", () => {
    test("edit the title and save", async ({
      metadataEditPage,
      bookDetailPage,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);

      await test.step("open the edit sheet and change the title", async () => {
        await metadataEditPage.goto(uuid);
        await form.enterTitle("Alpha Edited");
      });

      await test.step("check the save bar counts the edit", async () => {
        await expect(form.saveButton).toBeEnabled();
        await expect(form.editedSummary(1)).toBeVisible();
      });

      await test.step("save", async () => {
        await expectMutation(overrides.save(), () => form.save());
      });

      await test.step("check the book page shows the edited title", async () => {
        await bookDetailPage.assertDisplayedFor(uuid);
        await expect(bookDetailPage.titleHeading).toHaveText("Alpha Edited");
      });
    });

    test("revert the overrides to the scanned values", async ({
      metadataEditPage,
      bookDetailPage,
      overridesRequests,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("override the title through the api", async () => {
        const saved = await overridesRequests.postOverrides(uuid, {
          title: "Alpha Edited",
        });
        await expect(saved).toBeOK();
        overriddenBookUuids.add(uuid);
      });

      await test.step("open the edit sheet", async () => {
        await metadataEditPage.goto(uuid);
        await expect(metadataEditPage.revertButton).toBeVisible();
      });

      await test.step("revert", async () => {
        await expectMutation(overrides.revert(), () =>
          metadataEditPage.revertOverrides(),
        );
      });

      await test.step("check the book page shows the scanned title", async () => {
        await bookDetailPage.assertDisplayedFor(uuid);
        await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      });
    });

    test("add a tag in the chip row", async ({
      metadataEditPage,
      bookDetailPage,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);

      await test.step("open the edit sheet and add a tag", async () => {
        await metadataEditPage.goto(uuid);
        await form.addTag("test-tag");
      });

      await test.step("check the chip landed and the save bar is dirty", async () => {
        await expect(form.tagChip("test-tag")).toBeVisible();
        await expect(form.saveButton).toBeEnabled();
      });

      await test.step("save", async () => {
        await expectMutation(overrides.save(), () => form.save());
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    test("edit the ISBN-10 and print page count", async ({
      metadataEditPage,
      bookDetailPage,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);

      await test.step("open the edit sheet and edit both fields", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.isbn10Field).toBeVisible();
        await form.enterIsbn10("0134685997");
        await form.enterPrintPages("412");
      });

      await test.step("check the save bar counts both edits", async () => {
        await expect(form.saveButton).toBeEnabled();
        await expect(form.editedSummary(2)).toBeVisible();
      });

      await test.step("save", async () => {
        await expectMutation(overrides.save(), () => form.save());
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("reopen the form and check both fields persisted", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.isbn10Field).toHaveValue("0134685997");
        await expect(form.printPagesField).toHaveValue("412");
        await expect(metadataEditPage.revertButton).toBeVisible();
      });

      await test.step("revert the overrides", async () => {
        await expectMutation(overrides.revert(), () =>
          metadataEditPage.revertOverrides(),
        );
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    test("discard the edits without saving", async ({
      metadataEditPage,
      bookDetailPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit sheet and change the title", async () => {
        await metadataEditPage.goto(uuid);
        await form.enterTitle("Should Not Be Saved");
      });

      await test.step("discard", async () => {
        await form.discard();
      });

      // Discarding resets the form and keeps the sheet open.
      await test.step("check the form is back to the scanned title", async () => {
        await expect(form.titleField).toHaveValue(TARGET.title);
        await expect(form.saveState).toHaveText("No changes");
      });

      await test.step("close and check the book page shows the original title", async () => {
        await metadataEditPage.close();
        await bookDetailPage.assertDisplayedFor(uuid);
        await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      });
    });

    test("stay on the edit form when the save fails", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("change the title so Save will fire", async () => {
        await metadataEditPage.goto(uuid);
        await form.enterTitle("Alpha Should Not Persist");
        await expect(form.saveButton).toBeEnabled();
      });

      await test.step("save while the server fails the write", async () => {
        await metadataEditPage.forceServerError(overrides.save());
        await expectMutation(failing(overrides.save()), () => form.save());
      });

      await test.step("check the form keeps the edit and Done can retry", async () => {
        await metadataEditPage.assertDisplayedFor(uuid);
        await expect(form.saveError).toBeVisible();
        await expect(form.titleField).toHaveValue("Alpha Should Not Persist");
        await expect(form.editedSummary(1)).toBeVisible();
        await expect(form.saveButton).toBeEnabled();
      });
    });

    test("stay on the edit form when the revert fails", async ({
      metadataEditPage,
      bookDetailPage,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);

      await test.step("override the title through the form", async () => {
        await metadataEditPage.goto(uuid);
        await metadataEditPage.form.enterTitle("Alpha Revert Setup");
        await expectMutation(overrides.save(), () =>
          metadataEditPage.form.save(),
        );
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("reopen the edit sheet, where Revert shows", async () => {
        await metadataEditPage.goto(uuid);
        await expect(metadataEditPage.revertButton).toBeVisible();
      });

      await test.step("revert while the server fails the write", async () => {
        await metadataEditPage.forceServerError(overrides.revert());
        await expectMutation(failing(overrides.revert()), () =>
          metadataEditPage.revertOverrides(),
        );
      });

      // The dialog says why and stays open over the sheet, which keeps Revert.
      await test.step("check the override is still active", async () => {
        await expect(metadataEditPage.revertError).toBeVisible();
        await metadataEditPage.cancelRevert();
        await metadataEditPage.assertDisplayedFor(uuid);
        await expect(metadataEditPage.revertButton).toBeVisible();
        await expect(metadataEditPage.revertButton).toBeEnabled();
      });

      await test.step("retry once the server recovers", async () => {
        await metadataEditPage.stopForcingServerError(overrides.revert());
        await expectMutation(overrides.revert(), () =>
          metadataEditPage.revertOverrides(),
        );
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      // The 200 alone does not show the override went: the scanned title is back and Revert is gone.
      await test.step("check the override was actually removed", async () => {
        await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
        await metadataEditPage.goto(uuid);
        await expect(metadataEditPage.revertButton).toHaveCount(0);
      });
    });
  });

  // Suggestions are a native datalist: the browser draws and picks from it, so
  // a test reads what it offers and commits by typing, as a pick would fill it.
  test.describe("suggestions", () => {
    test("suggest existing authors as a prefix is typed", async ({
      metadataEditPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit sheet and type an author prefix", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.authorsInput).toBeVisible();
        await form.typeAuthor("Nik");
      });

      // Niklaus Wirth is a Code Quartet author, and each option carries a book count.
      await test.step("check existing authors are suggested", async () => {
        await expect
          .poll(() => form.authorSuggestions())
          .toContainEqual({
            value: "Niklaus Wirth",
            label: expect.stringMatching(/\d+ books?/),
          });
        await expect
          .poll(async () =>
            (await form.authorSuggestions()).every((s) =>
              s.value.toLowerCase().includes("nik"),
            ),
          )
          .toBe(true);
      });

      await test.step("commit the suggested name", async () => {
        await form.typeAuthor("Niklaus Wirth");
        await form.commitAuthor();
      });

      await test.step("check the chip landed and the input cleared", async () => {
        await expect(form.authorChip("Niklaus Wirth")).toBeVisible();
        await expect(form.authorsInput).toHaveValue("");
        // A name already on the book is not offered again.
        await expect
          .poll(async () =>
            (await form.authorSuggestions()).map((s) => s.value),
          )
          .not.toContain("Niklaus Wirth");
      });
    });

    test("add a typed author when no suggestion matches", async ({
      metadataEditPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit sheet and type an unknown author", async () => {
        await metadataEditPage.goto(uuid);
        await form.typeAuthor("ZzzMatchesNothing");
      });

      await test.step("check nothing is suggested", async () => {
        await expect.poll(() => form.authorSuggestions()).toEqual([]);
      });

      await test.step("commit the typed value", async () => {
        await form.commitAuthor();
        await expect(form.authorChip("ZzzMatchesNothing")).toBeVisible();
        await expect(form.authorsInput).toHaveValue("");
      });
    });

    test("fill the series from a suggestion", async ({
      metadataEditPage,
      bookDetailPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit sheet", async () => {
        await metadataEditPage.goto(uuid);
        // Alpha is standalone, so the field starts empty.
        await expect(form.seriesField).toBeVisible();
        await expect(form.seriesField).toHaveValue("");
      });

      // Code Quartet backs four fixture books.
      await test.step("check the existing series is suggested", async () => {
        await expect
          .poll(async () =>
            (await form.seriesSuggestions()).map((s) => s.value),
          )
          .toContain("Code Quartet");
      });

      await test.step("take the suggestion", async () => {
        await form.typeSeries("Code Quartet");
        await expect(form.seriesField).toHaveValue("Code Quartet");
        await expect(form.editedSummary(1)).toBeVisible();
      });

      await test.step("discard and close", async () => {
        await form.discard();
        await metadataEditPage.close();
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    // Series takes free text and keeps it whether or not a suggestion matches.
    test("accept a series name no suggestion matches", async ({
      metadataEditPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit sheet and type an unknown series", async () => {
        await metadataEditPage.goto(uuid);
        await form.typeSeries("ZzzBrandNewSeries");
      });

      await test.step("check no suggestion matches and the text stays", async () => {
        await expect
          .poll(async () =>
            (await form.seriesSuggestions()).map((s) => s.value),
          )
          .not.toContain("ZzzBrandNewSeries");
        await expect(form.seriesField).toHaveValue("ZzzBrandNewSeries");
        await expect(form.editedSummary(1)).toBeVisible();
      });
    });
  });

  // The cover card lives on the Artwork tab. Putting the scanned cover back is
  // written at once; a picked or pasted cover is held until Done.
  test.describe("cover", () => {
    test("show an uploaded cover override", async ({
      metadataEditPage,
      overridesRequests,
      overriddenBookUuids,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the artwork tab on the scanned cover", async () => {
        await metadataEditPage.goto(uuid);
        await form.openArtwork();
        await expect(form.coverHintText).toHaveText("extracted from file");
        await expect(form.removeCoverOverrideButton).toHaveCount(0);
      });

      await test.step("upload a cover through the api", async () => {
        const uploaded = await overridesRequests.postCover(uuid, TINY_PNG);
        await expect(uploaded).toBeOK();
        overriddenBookUuids.add(uuid);
        await metadataEditPage.reload();
        await form.openArtwork();
      });

      await test.step("check the cover is marked as an upload", async () => {
        await expect(form.coverHintText).toHaveText("custom upload");
        await expect(form.removeCoverOverrideButton).toBeVisible();
      });
    });

    test("revert an uploaded cover override", async ({
      metadataEditPage,
      overridesRequests,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("upload a cover through the api", async () => {
        const uploaded = await overridesRequests.postCover(uuid, TINY_PNG);
        await expect(uploaded).toBeOK();
        overriddenBookUuids.add(uuid);
      });

      await test.step("open the artwork tab", async () => {
        await metadataEditPage.goto(uuid);
        await form.openArtwork();
        await expect(form.removeCoverOverrideButton).toBeVisible();
      });

      await test.step("revert the cover", async () => {
        await expectMutation(covers.revert(), () => form.removeCoverOverride());
      });

      await test.step("check the scanned cover is back", async () => {
        await expect(form.coverUploadStatus).toHaveText(
          "Reverted to scanned cover.",
        );
        await expect(form.coverHintText).toHaveText("extracted from file");
        await expect(form.removeCoverOverrideButton).toHaveCount(0);
      });
    });

    test("keep the cover override when the revert fails", async ({
      metadataEditPage,
      overridesRequests,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("upload a cover through the api", async () => {
        const uploaded = await overridesRequests.postCover(uuid, TINY_PNG);
        await expect(uploaded).toBeOK();
        overriddenBookUuids.add(uuid);
      });

      await test.step("open the artwork tab", async () => {
        await metadataEditPage.goto(uuid);
        await form.openArtwork();
        await expect(form.removeCoverOverrideButton).toBeVisible();
      });

      await test.step("revert while the server fails the write", async () => {
        await metadataEditPage.forceServerError(covers.revert());
        await expectMutation(failing(covers.revert()), () =>
          form.removeCoverOverride(),
        );
      });

      // The status line names the failure and the control stays usable for a retry.
      await test.step("check the override is still active", async () => {
        await expect(form.coverUploadStatus).toContainText("Revert failed");
        await expect(form.coverHintText).toHaveText("custom upload");
        await expect(form.removeCoverOverrideButton).toBeVisible();
        await expect(form.removeCoverOverrideButton).toBeEnabled();
      });

      await test.step("retry once the server recovers", async () => {
        await metadataEditPage.stopForcingServerError(covers.revert());
        await expectMutation(covers.revert(), () => form.removeCoverOverride());
        await expect(form.coverHintText).toHaveText("extracted from file");
      });
    });

    test("apply a pasted cover URL", async ({
      metadataEditPage,
      bookDetailPage,
      ebooksRequests,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const commits = metadataEditPage.recordCoverWrites();

      await test.step("stub the write with the book as the server returns it", async () => {
        const book = await ebooksRequests.getEbook(uuid);
        await expect(book).toBeOK();
        await metadataEditPage.stubCoverFromUrl(await book.json());
      });

      await test.step("open the artwork tab and check Apply follows the field", async () => {
        await metadataEditPage.goto(uuid);
        await form.openArtwork();
        await expect(form.applyCoverUrlButton).toBeDisabled();
        await form.enterCoverUrl(PASTED_COVER_URL);
        await expect(form.applyCoverUrlButton).toBeEnabled();
        await form.enterCoverUrl("");
        await expect(form.applyCoverUrlButton).toBeDisabled();
      });

      // Apply holds the image; nothing is fetched until Done.
      await test.step("apply the URL", async () => {
        await form.enterCoverUrl(PASTED_COVER_URL);
        await form.applyCoverUrl();
        await expect(form.coverHintText).toHaveText(
          "from the web · fetched when you press Done",
        );
        await expect(form.coverUrlField).toHaveValue("");
        await expect(form.dropHeldCoverButton).toBeVisible();
        await expect(form.editedSummary(1)).toBeVisible();
        expect(commits).toEqual([]);
      });

      await test.step("save the held cover", async () => {
        await expectMutation(covers.fromUrl(uuid, PASTED_COVER_URL), () =>
          form.save(),
        );
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    test("keep the held cover URL when fetching it fails", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("hold a pasted URL while the server fails the write", async () => {
        await metadataEditPage.forceServerError(
          covers.fromUrl(uuid, PASTED_COVER_URL),
        );
        await metadataEditPage.goto(uuid);
        await form.openArtwork();
        await form.enterCoverUrl(PASTED_COVER_URL);
        await form.submitCoverUrl();
      });

      await test.step("save it", async () => {
        await expectMutation(
          failing(covers.fromUrl(uuid, PASTED_COVER_URL)),
          () => form.save(),
        );
      });

      await test.step("check the failure shows and the cover is still held", async () => {
        await metadataEditPage.assertDisplayedFor(uuid);
        await expect(form.saveError).toContainText("Cover not saved");
        await expect(form.saveError).toContainText("forced failure");
        await expect(form.coverHintText).toHaveText(
          "from the web · fetched when you press Done",
        );
        await expect(form.editedSummary(1)).toBeVisible();
        await expect(form.saveButton).toBeEnabled();
      });
    });
  });
});
