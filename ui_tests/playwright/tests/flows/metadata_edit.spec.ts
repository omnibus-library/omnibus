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

test.describe("metadata edit page", () => {
  // Every test reads or writes override state on the same book, so they run one at a time.
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the metadata edit page layout", async ({
    metadataEditPage,
    request,
  }) => {
    const { form } = metadataEditPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the edit page", async () => {
      await metadataEditPage.goto(uuid);
    });

    await test.step("check the page, its nav and its header", async () => {
      await metadataEditPage.assertDisplayed();
      await metadataEditPage.topNav.assertDisplayed();
      await expect(metadataEditPage.bookHeading(TARGET.title)).toBeVisible();
      await expect(metadataEditPage.breadcrumbHomeLink).toBeVisible();
    });

    await test.step("check the form is pre-populated", async () => {
      await expect(form.titleField).toBeVisible();
      await expect(form.titleField).toHaveValue(TARGET.title);
      await expect(form.authorChip(TARGET.authors[0]!)).toBeVisible();
    });

    // The discard link names what it drops: a replaced cover is written at once and it cannot undo one.
    await test.step("check the save bar and the cover URL field", async () => {
      await expect(form.saveButton).toBeVisible();
      await expect(form.discardButton).toHaveText("Discard edits");
      await expect(form.saveButton).toBeDisabled();
      await expect(form.coverUrlField).toBeVisible();
      await expect(form.coverUrlField).toHaveAttribute("type", "url");
      await expect(form.applyCoverUrlButton).toBeDisabled();
    });
  });

  test("open the edit page from the book detail page", async ({
    bookDetailPage,
    metadataEditPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
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

      await test.step("open the edit page and change the title", async () => {
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

      await test.step("open the edit page", async () => {
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

      await test.step("open the edit page and add a tag", async () => {
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

      await test.step("open the edit page and edit both fields", async () => {
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

      await test.step("open the edit page and change the title", async () => {
        await metadataEditPage.goto(uuid);
        await form.enterTitle("Should Not Be Saved");
      });

      await test.step("discard", async () => {
        await form.discard();
      });

      await test.step("check the book page shows the original title", async () => {
        await bookDetailPage.assertDisplayedFor(uuid);
        await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      });
    });

    // The page shows no status or alert for the failure, so what is observable
    // is that it stays on the form and Save comes out of "Saving…".
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

      await test.step("check the form keeps the edit and Save can retry", async () => {
        await metadataEditPage.assertDisplayedFor(uuid);
        await expect(form.titleField).toHaveValue("Alpha Should Not Persist");
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

      await test.step("reopen the edit page, where Revert shows", async () => {
        await metadataEditPage.goto(uuid);
        await expect(metadataEditPage.revertButton).toBeVisible();
      });

      await test.step("revert while the server fails the write", async () => {
        await metadataEditPage.forceServerError(overrides.revert());
        await expectMutation(failing(overrides.revert()), () =>
          metadataEditPage.revertOverrides(),
        );
      });

      await test.step("check the override is still active", async () => {
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

  test.describe("suggestions", () => {
    test("add an author from the suggestions with the arrow keys", async ({
      metadataEditPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page and type an author prefix", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.authorsInput).toBeVisible();
        await form.typeAuthor("Nik");
      });

      // Niklaus Wirth is a Code Quartet author, and each row carries a book count.
      await test.step("check existing authors are suggested", async () => {
        await expect(form.authorSuggestions).toBeVisible();
        await expect(form.authorSuggestion(/Niklaus Wirth/)).toBeVisible();
        await expect(
          form.authorSuggestion(/Niklaus Wirth.*books?/),
        ).toBeVisible();
        // At most MAX_SUGGESTIONS=5 rows plus the "+ Create" footer.
        await expect
          .poll(() => form.authorSuggestionCount(), {
            message: "the dropdown must cap at 5 suggestions + 1 create row",
          })
          .toBeLessThanOrEqual(6);
      });

      await test.step("pick the first suggestion", async () => {
        await form.pickFirstAuthorSuggestion();
      });

      await test.step("check the chip landed and the input cleared", async () => {
        await expect(form.authorChip("Niklaus Wirth")).toBeVisible();
        await expect(form.authorsInput).toHaveValue("");
        await expect(form.authorSuggestions).toHaveCount(0);
      });
    });

    test("add a typed author when no suggestion matches", async ({
      metadataEditPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page and type an unknown author", async () => {
        await metadataEditPage.goto(uuid);
        await form.typeAuthor("ZzzMatchesNothing");
      });

      // The footer lets the reader commit a new value without dismissing the dropdown.
      await test.step("check only the create row is offered", async () => {
        await expect(form.authorSuggestions).toBeVisible();
        await expect(
          form.authorSuggestion(/\+ Create.*ZzzMatchesNothing/),
        ).toBeVisible();
        await expect(form.authorSuggestionOptions).toHaveCount(1);
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

      await test.step("open the edit page and type a series prefix", async () => {
        await metadataEditPage.goto(uuid);
        // Alpha is standalone, so the field starts empty.
        await expect(form.seriesField).toBeVisible();
        await expect(form.seriesField).toHaveValue("");
        await form.typeSeries("Cod");
      });

      // Code Quartet backs four fixture books, like the Author(s) field's dropdown.
      await test.step("check the existing series is suggested", async () => {
        await expect(form.seriesSuggestions).toBeVisible();
        await expect(form.seriesSuggestion(/Code Quartet/)).toBeVisible();
      });

      await test.step("pick the suggestion", async () => {
        await form.pickFirstSeriesSuggestion();
        await expect(form.seriesField).toHaveValue("Code Quartet");
        await expect(form.seriesSuggestions).toHaveCount(0);
        await expect(form.saveButton).toBeEnabled();
      });

      await test.step("discard", async () => {
        await form.discard();
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    // Series takes free text like the chip editors but has no committed list, so no create row.
    test("accept a series name no suggestion matches", async ({
      metadataEditPage,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page and type an unknown series", async () => {
        await metadataEditPage.goto(uuid);
        await form.typeSeries("ZzzBrandNewSeries");
      });

      await test.step("check no dropdown shows and the text stays", async () => {
        await expect(form.seriesSuggestions).toHaveCount(0);
        await expect(form.seriesField).toHaveValue("ZzzBrandNewSeries");
      });
    });
  });

  test.describe("cover", () => {
    test("show an uploaded cover override", async ({
      metadataEditPage,
      overridesRequests,
      overriddenBookUuids,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page on the scanned cover", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.coverHintText).toHaveText("extracted from file");
        await expect(form.removeCoverOverrideButton).toHaveCount(0);
      });

      // The upload goes by direct multipart POST, as author_photo does, so no synthetic file-change event is needed.
      await test.step("upload a cover through the api", async () => {
        const uploaded = await overridesRequests.postCover(uuid, TINY_PNG);
        await expect(uploaded).toBeOK();
        overriddenBookUuids.add(uuid);
        await metadataEditPage.reload();
      });

      await test.step("check the cover is marked as an upload", async () => {
        await expect(form.coverHintText).toHaveText("custom upload");
        await expect(form.removeCoverOverrideButton).toBeVisible();
      });
    });

    // The no-body revert rides the server-function transport: a POST with the uuid in its body.
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

      await test.step("open the edit page", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.removeCoverOverrideButton).toBeVisible();
      });

      await test.step("revert the cover", async () => {
        await expectMutation(covers.revert(), () => form.removeCoverOverride());
      });

      await test.step("check the scanned cover is back", async () => {
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

      await test.step("open the edit page", async () => {
        await metadataEditPage.goto(uuid);
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
      overridesRequests,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("stub the write with the book as the server returns it", async () => {
        const book = await overridesRequests.getEbook(uuid);
        await expect(book).toBeOK();
        await metadataEditPage.stubCoverFromUrl(await book.json());
      });

      await test.step("open the edit page and check Apply follows the field", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.applyCoverUrlButton).toBeDisabled();
        await form.enterCoverUrl(PASTED_COVER_URL);
        await expect(form.applyCoverUrlButton).toBeEnabled();
        await form.enterCoverUrl("");
        await expect(form.applyCoverUrlButton).toBeDisabled();
      });

      await test.step("apply the URL", async () => {
        await form.enterCoverUrl(PASTED_COVER_URL);
        await expectMutation(covers.fromUrl(uuid, PASTED_COVER_URL), () =>
          form.applyCoverUrl(),
        );
      });

      await test.step("check the cover shows as replaced", async () => {
        await expect(form.coverUploadStatus).toHaveText("Cover updated.");
        await expect(form.coverHintText).toHaveText("custom upload");
        await expect(form.coverUrlField).toHaveValue("");
        await expect(form.removeCoverOverrideButton).toBeVisible();
        await expect(form.currentCoverImage).toHaveAttribute(
          "src",
          /[?&]v=\d+/,
        );
        await expect(form.coverReplacedNote).toBeVisible();
      });
    });

    test("keep the typed URL when applying it fails", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { form } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page and type a URL while the server fails the write", async () => {
        await metadataEditPage.forceServerError(
          covers.fromUrl(uuid, PASTED_COVER_URL),
        );
        await metadataEditPage.goto(uuid);
        await form.enterCoverUrl(PASTED_COVER_URL);
      });

      await test.step("submit it with Enter", async () => {
        await expectMutation(
          failing(covers.fromUrl(uuid, PASTED_COVER_URL)),
          () => form.submitCoverUrl(),
        );
      });

      await test.step("check the failure shows and nothing changed", async () => {
        await expect(form.coverUploadStatus).toContainText(
          "Couldn't apply that URL",
        );
        await expect(form.coverUploadStatus).toContainText("forced failure");
        await expect(form.coverUrlField).toHaveValue(PASTED_COVER_URL);
        await expect(form.coverHintText).toHaveText("extracted from file");
        await expect(form.removeCoverOverrideButton).toHaveCount(0);
        await expect(form.applyCoverUrlButton).toBeEnabled();
      });
    });
  });
});
