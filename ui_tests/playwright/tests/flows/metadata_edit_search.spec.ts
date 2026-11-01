import { covers } from "../contracts/covers";
import { metadata } from "../contracts/metadata";
import { overrides } from "../contracts/overrides";
import {
  ALL_CONFIGURED,
  type EditionSearchQuery,
  FOUND,
  GB_ANSWERED,
  GB_CANDIDATE,
  HC_CANDIDATE,
  HC_CONFIGURED,
  HC_FOUND,
  NONE_CONFIGURED,
  OL_ANSWERED,
  OL_CANDIDATE,
  PIXEL,
  STANDARD_ANSWERS,
  source,
} from "../data/editions";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Every provider response is stubbed, so no live provider or key is needed.
// `mathematica-minor-2` ("Minor Lemmas II") is read by no other spec: one test
// saves a real override on it and reverts it.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "mathematica-minor-2")!;

const ISBN = "9781234567897";

test.describe("metadata edit fetch metadata", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the fetch metadata layout", async ({
    metadataEditPage,
    expectMutation,
    request,
  }) => {
    const { fetchView } = metadataEditPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the edit sheet with every provider configured", async () => {
      await fetchView.stubEditionLookup(STANDARD_ANSWERS);
      await metadataEditPage.goto(uuid);
    });

    await test.step("check Fetch metadata is offered but closed", async () => {
      await metadataEditPage.assertDisplayed();
      await metadataEditPage.topNav.assertDisplayed();
      await expect(fetchView.openButton).toBeVisible();
      await expect(fetchView.openButton).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(fetchView.root).toHaveCount(0);
    });

    // It searches as it opens, on the book's title and first author.
    await test.step("open it", async () => {
      const { request: sent } = await expectMutation(metadata.search(), () =>
        fetchView.open(),
      );
      const req: EditionSearchQuery = sent.postDataJSON();
      expect(req.title).toBe(TARGET.title);
      expect(req.author).toBe(TARGET.authors[0]);
      expect(req.isbn ?? null).toBeNull();
    });

    await test.step("check it is seeded from the book and lists editions", async () => {
      await expect(fetchView.openButton).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(fetchView.queryField).toHaveValue(TARGET.title);
      await expect(fetchView.authorField).toHaveValue(TARGET.authors[0]!);
      await expect(fetchView.editionList).toBeVisible();
    });
  });

  test.describe("query", () => {
    // The ISBN is the exact question, so the form's value would narrow every source to one edition.
    test("send the book's ISBN with the search", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      test.fixme(
        true,
        "React's Fetch metadata seeds its query from the title, never the book's ISBN-13",
      );
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("put an ISBN in the form and open Fetch metadata", async () => {
        await fetchView.stubEditionLookup(STANDARD_ANSWERS);
        await metadataEditPage.goto(uuid);
        await form.enterIsbn13(ISBN);
        const { request: sent } = await expectMutation(metadata.search(), () =>
          fetchView.open(),
        );
        const req: EditionSearchQuery = sent.postDataJSON();
        expect(req.isbn).toBe(ISBN);
      });
    });

    // One box takes a title or an ISBN, and reads which it was given.
    test("widen an ISBN search back to the title", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("search on the ISBN", async () => {
        await fetchView.enterQuery({ query: ISBN });
        const { request: sent } = await expectMutation(metadata.search(), () =>
          fetchView.search(),
        );
        const req: EditionSearchQuery = sent.postDataJSON();
        expect(req.isbn).toBe(ISBN);
      });

      await test.step("put the title back and search", async () => {
        await fetchView.enterQuery({ query: TARGET.title });
        const { request: sent } = await expectMutation(metadata.search(), () =>
          fetchView.search(),
        );
        const req: EditionSearchQuery = sent.postDataJSON();
        expect(req.isbn ?? null).toBeNull();
        expect(req.title).toBe(TARGET.title);
      });
    });

    // Any keystroke used to collapse the fields into one phrase that Open Library matched against titles alone.
    test("send the title and author each as itself", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("edit both fields and search again", async () => {
        await fetchView.enterQuery({
          query: "Minor Lemmas",
          author: "Germain",
        });
        const { request: sent } = await expectMutation(metadata.search(), () =>
          fetchView.search(),
        );
        const req: EditionSearchQuery = sent.postDataJSON();
        expect(req.title).toBe("Minor Lemmas");
        expect(req.author).toBe("Germain");
        expect(req.isbn ?? null).toBeNull();
      });
    });

    // An ISBN is the strongest question any provider takes.
    test("search on an ISBN alone", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("keep only the ISBN", async () => {
        await fetchView.enterQuery({ query: ISBN, author: "" });
        await expect(fetchView.searchButton).toBeEnabled();
      });

      await test.step("search", async () => {
        const { request: sent } = await expectMutation(metadata.search(), () =>
          fetchView.search(),
        );
        const req: EditionSearchQuery = sent.postDataJSON();
        expect(req.isbn).toBe(ISBN);
        expect(req.title ?? null).toBeNull();
      });
    });

    test("disable the search until a field has something in it", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("empty both fields", async () => {
        await fetchView.enterQuery({ query: "", author: "" });
        await expect(fetchView.searchButton).toBeDisabled();
      });

      await test.step("fill one back in", async () => {
        await fetchView.enterQuery({ author: "Germain" });
        await expect(fetchView.searchButton).toBeEnabled();
      });
    });
  });

  test.describe("closing", () => {
    test("close Fetch metadata with Back to editing", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("go back to editing", async () => {
        await fetchView.back();
        await expect(fetchView.root).toHaveCount(0);
        await expect(form.titleField).toHaveValue(TARGET.title);
      });
    });

    test("close Fetch metadata by pressing it again", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.root).toBeVisible();
      });

      await test.step("press Fetch metadata again", async () => {
        await fetchView.toggleClosed();
        await expect(fetchView.root).toHaveCount(0);
        await expect(form.titleField).toBeVisible();
      });
    });
  });

  test.describe("results", () => {
    test("list an edition per source with cover, title, authors and origin", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("check the Open Library edition", async () => {
        const row = fetchView.editionButton("open-library");
        await expect(row).toContainText(OL_CANDIDATE.title);
        await expect(row).toContainText(
          "Sophie Germain · Klein Mathematik 1815 · 212 pages",
        );
        await expect(row).toContainText("Open Library · 9781234567897");
        await expect(fetchView.editionCover("open-library")).toBeVisible();
      });

      await test.step("check the same ISBN under a second source stays its own row", async () => {
        const row = fetchView.editionButton("google-books");
        await expect(row).toContainText(GB_CANDIDATE.title);
        await expect(row).toContainText("Google Books · 9781234567897");
      });
    });

    // The stub answers Google Books first; a slow or newly configured provider must not reshuffle the rows.
    test("order editions by the editions themselves, not by who answered", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("check the title that sorts first leads", async () => {
        await expect(fetchView.editionButtons).toHaveText([
          /Open Library/,
          /Google Books/,
        ]);
      });
    });

    // A short list has several causes and they are not interchangeable.
    test("say what every source contributed, including the ones that did not", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search while one source answers nothing and one fails", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
          found: {
            editions: [OL_CANDIDATE],
            sources: [
              OL_ANSWERED,
              source("google_books", { kind: "answered", count: 0 }),
              source("hardcover", {
                kind: "failed",
                message: "request timed out",
              }),
            ],
          },
        });
      });

      await test.step("check each outcome reads differently", async () => {
        await expect(fetchView.sourceNote("open-library")).toHaveText(
          "Open Library 1",
        );
        await expect(fetchView.sourceNote("google-books")).toHaveText(
          "Google Books nothing",
        );
        await expect(fetchView.sourceNote("hardcover")).toHaveText(
          "Hardcover unavailable",
        );
        // The provider's own message is there without the line becoming an error log.
        await expect(fetchView.sourceNote("hardcover")).toHaveAttribute(
          "title",
          "request timed out",
        );
      });
    });

    // Nothing is broken: the source asked us to come back later, and we did not spend a request finding that out again.
    test("report a rate-limited provider as a wait, not a failure", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search while one source is throttled", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
          found: {
            editions: [OL_CANDIDATE],
            sources: [
              OL_ANSWERED,
              GB_ANSWERED,
              source("hardcover", {
                kind: "throttled",
                retry_after_secs: 600,
              }),
            ],
          },
        });
      });

      await test.step("check the source reads as a wait", async () => {
        await expect(fetchView.sourceNote("hardcover")).toHaveText(
          "Hardcover rate limited, skipping for 10m",
        );
        await expect(fetchView.sourceNote("hardcover")).toHaveAttribute(
          "title",
          /rate-limited us recently/,
        );
      });
    });

    // A work-level search hit, as Hardcover's `search` returns, has no year, publisher or edition ISBN.
    test("keep the row of an edition that names no printing", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search while an edition names no printing", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
          found: {
            ...FOUND,
            editions: [
              { ...OL_CANDIDATE, isbn13: null, year: null, publisher: null },
            ],
          },
        });
      });

      await test.step("check its row still names the book and its source", async () => {
        const row = fetchView.editionButton("open-library");
        await expect(row).toContainText(OL_CANDIDATE.title);
        await expect(row).toContainText("Sophie Germain · 212 pages");
        await expect(row).toContainText("Open Library");
      });
    });

    test("report a provider with no key as not set up", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(fetchView.editionList).toBeVisible();
      });

      await test.step("check the unkeyed provider reads as not set up", async () => {
        await expect(fetchView.sourceNote("hardcover")).toHaveText(
          "Hardcover not set up",
        );
      });
    });

    test("show a search failure and leave the form values alone", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search while the server fails the search", async () => {
        await metadataEditPage.forceServerError(metadata.search());
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
        });
      });

      await test.step("check the error shows without editions", async () => {
        await expect(fetchView.errorMessage).toBeVisible();
        await expect(fetchView.editionList).toHaveCount(0);
      });

      await test.step("go back and check the form never moved", async () => {
        await fetchView.back();
        await expect(form.titleField).toHaveValue(TARGET.title);
        await expect(form.saveState).toHaveText("No changes");
      });
    });

    test("hide the entry point when no provider is configured", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit sheet with no provider configured", async () => {
        await fetchView.stubEditionLookup({ catalog: NONE_CONFIGURED });
        await metadataEditPage.goto(uuid);
      });

      await test.step("check Fetch metadata is not offered", async () => {
        await expect(fetchView.openButton).toHaveCount(0);
      });
    });
  });

  test.describe("diff", () => {
    test("show only the fields the source would change", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("pick the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await expect(fetchView.diff).toBeVisible();
      });

      await test.step("check the rows that differ", async () => {
        await expect(fetchView.diffRow("Title")).toContainText(
          GB_CANDIDATE.title,
        );
        await expect(fetchView.diffRow("Publisher")).toContainText(
          "Editions Gauss",
        );
      });

      // A source with no series cannot change one, and a row that cannot be applied is only noise.
      await test.step("check the rows it cannot change are absent", async () => {
        await expect(fetchView.diffRow("Series")).toHaveCount(0);
        await expect(fetchView.diffRow("Genres")).toHaveCount(0);
      });

      await test.step("check looking changed nothing", async () => {
        await expect(form.saveState).toHaveText("No changes");
      });
    });

    test("toggle the unchanged fields", async () => {
      test.fixme(
        true,
        "React's Fetch metadata diff has no toggle to show the fields a source leaves alone",
      );
    });

    // Filling a blank is safe, overwriting a value is the reader's call.
    test("start a row checked only where the book has nothing", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("pick the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
      });

      await test.step("check the overwrites start off and the fills start on", async () => {
        await expect(fetchView.diffCheckbox("Publisher")).not.toBeChecked();
        await expect(fetchView.diffCheckbox("Title")).not.toBeChecked();
        // The book has no ISBN of its own.
        await expect(fetchView.diffCheckbox("ISBN-13")).toBeChecked();
        // The book has a cover, so the source's does not replace it unasked.
        await expect(fetchView.diffCheckbox("Cover")).not.toBeChecked();
      });
    });

    test("copy one field into the form", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("pick the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await expect(fetchView.diffRow("Publisher")).toContainText(
          TARGET.publisher!,
        );
      });

      await test.step("copy the publisher", async () => {
        await fetchView.choose(["Publisher"]);
        await expect(fetchView.applyButton).toHaveText("Apply 1 change");
        await fetchView.apply();
      });

      await test.step("check the form holds it and nothing else moved", async () => {
        await expect(fetchView.root).toHaveCount(0);
        await expect(form.publisherField).toHaveValue("Editions Gauss");
        await expect(form.titleField).toHaveValue(TARGET.title);
      });

      // Applied only: the save bar counts it and no write went out.
      await test.step("check the save bar counts the edit", async () => {
        await expect(form.editedSummary(1)).toBeVisible();
        await expect(form.saveButton).toBeEnabled();
      });
    });

    test("undo an applied field", async ({ metadataEditPage, request }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("copy the publisher from the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await fetchView.choose(["Publisher"]);
        await fetchView.apply();
        await expect(form.publisherField).toHaveValue("Editions Gauss");
      });

      await test.step("discard the edits", async () => {
        await form.discard();
      });

      await test.step("check the book's own value is back", async () => {
        await expect(form.publisherField).toHaveValue(TARGET.publisher!);
        await expect(form.saveState).toHaveText("No changes");
      });
    });

    // The retired one-provider panel set title, authors, description, series, book # and ISBN-13.
    test("offer every field the retired Hardcover panel could apply", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search with Hardcover configured", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: HC_CONFIGURED,
          found: HC_FOUND,
        });
        // Hardcover is a source in its own right, not a "not set up" row.
        await expect(fetchView.sourceNote("hardcover")).toHaveText(
          "Hardcover 1",
        );
      });

      await test.step("pick the Hardcover edition", async () => {
        await fetchView.pickEdition("hardcover");
        await expect(fetchView.diff).toBeVisible();
      });

      await test.step("check all six fields can be applied", async () => {
        for (const label of [
          "Title",
          "Author(s)",
          "Description",
          "Series",
          "Number in series",
          "ISBN-13",
        ]) {
          await expect(fetchView.diffCheckbox(label)).toBeEnabled();
        }
      });

      // Book # is the arm the retirement had to add: the panel could set one and the picker had no field for it.
      await test.step("apply the number in series", async () => {
        await fetchView.choose(["Number in series"]);
        await fetchView.apply();
        await expect(form.bookNumberField).toHaveValue(
          HC_CANDIDATE.series_index!,
        );
      });
    });

    test("take every change at once and skip what the source lacks", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("pick the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
      });

      await test.step("check every row and apply", async () => {
        await fetchView.chooseAll();
        await fetchView.apply();
      });

      await test.step("check every offered value is in the form", async () => {
        await expect(form.titleField).toHaveValue(GB_CANDIDATE.title);
        await expect(form.publisherField).toHaveValue("Editions Gauss");
        await expect(form.publishedField).toHaveValue("1816");
        await expect(form.isbn13Field).toHaveValue(ISBN);
        await expect(form.printPagesField).toHaveValue("220");
        await expect(form.descriptionField).toHaveValue(
          "A Google Books description.",
        );
        await expect(form.authorChip("Emmy Noether")).toBeVisible();
      });

      // Google Books offered no series, so applying everything keeps the book's own.
      await test.step("check what the source lacks is kept", async () => {
        await expect(form.seriesField).toHaveValue(TARGET.series!);
      });
    });

    test("keep an applied field across a trip back to Fetch metadata", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("copy the publisher from the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await fetchView.choose(["Publisher"]);
        await fetchView.apply();
      });

      await test.step("open Fetch metadata again and go back", async () => {
        await fetchView.openAndSearch();
        await expect(fetchView.editionList).toBeVisible();
        await fetchView.back();
      });

      // The view writes into the sheet's form, which outlives it.
      await test.step("check the apply is still there", async () => {
        await expect(form.publisherField).toHaveValue("Editions Gauss");
        await expect(form.editedSummary(1)).toBeVisible();
      });
    });

    test("drop an applied field when leaving without saving", async ({
      metadataEditPage,
      bookDetailPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("copy the publisher from the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await fetchView.choose(["Publisher"]);
        await fetchView.apply();
      });

      await test.step("close the sheet without saving", async () => {
        await metadataEditPage.close();
        await metadataEditPage.leaveWithoutSaving();
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("reopen the sheet and check nothing was kept", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.publisherField).toHaveValue(TARGET.publisher!);
        await expect(form.saveState).toHaveText("No changes");
      });
    });

    test("save exactly the applied values", async ({
      metadataEditPage,
      bookDetailPage,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);

      await test.step("copy the publisher from the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await fetchView.choose(["Publisher"]);
        await fetchView.apply();
      });

      // Fetch metadata never talks to the overrides endpoint itself: the sheet's own save does.
      await test.step("save", async () => {
        await expectMutation(
          overrides.save({ publisher: "Editions Gauss" }),
          () => form.save(),
        );
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      // The title the source also offered was never taken, so it must not have been written.
      await test.step("reopen the sheet and check only the applied field persisted", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.publisherField).toHaveValue("Editions Gauss");
        await expect(form.titleField).toHaveValue(TARGET.title);
      });

      await test.step("revert the override", async () => {
        await expectMutation(overrides.revert(), () =>
          metadataEditPage.revertOverrides(),
        );
      });
    });

    test("hold the diff back until the full record lands", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const detailDescription = "Only the detail record has this.";

      await test.step("search, then hold the re-fetch of the Open Library edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.holdHydrate();
        await fetchView.pickEdition("open-library");
      });

      // The search hit is a partial answer: showing it would have rows appear and rearrange a moment later.
      await test.step("check a placeholder shows instead of rows", async () => {
        await expect(fetchView.hydratingNotice).toBeVisible();
        await expect(fetchView.skeleton).toBeVisible();
        await expect(fetchView.diff).toHaveCount(0);
        await expect(fetchView.applyButton).toHaveCount(0);
      });

      await test.step("let the re-fetch land", async () => {
        fetchView.releaseHydrate({
          ...OL_CANDIDATE,
          description: detailDescription,
        });
      });

      await test.step("check the description arrived", async () => {
        await expect(fetchView.diffRow("Description")).toContainText(
          detailDescription,
        );
      });

      await test.step("apply it", async () => {
        await fetchView.choose(["Description"]);
        await fetchView.apply();
        await expect(form.descriptionField).toHaveValue(detailDescription);
      });
    });
  });

  // A source's cover is held like any other change and fetched by Done.
  test.describe("cover row", () => {
    test("offer the source's cover, saved when Done is pressed", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("pick the Google Books edition", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
      });

      // The row says so in words, not only in behaviour.
      await test.step("check the cover row", async () => {
        await expect(fetchView.diffRow("Cover")).toBeVisible();
        await expect(fetchView.coverThumb).toBeVisible();
        await expect(fetchView.diffRow("Cover")).toContainText(
          "Saved when you press Done",
        );
      });
    });

    test("leave the cover row out when the source has no cover", async ({
      metadataEditPage,
      request,
    }) => {
      const { fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("pick an edition with no cover", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
          found: {
            ...FOUND,
            editions: [{ ...OL_CANDIDATE, cover_url: null }],
          },
        });
        await fetchView.pickEdition("open-library");
        await expect(fetchView.diff).toBeVisible();
        await expect(fetchView.diffRow("Cover")).toHaveCount(0);
      });
    });

    test("save the source's cover with Done", async ({
      metadataEditPage,
      bookDetailPage,
      ebooksRequests,
      expectMutation,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const writes = metadataEditPage.recordCoverWrites();

      await test.step("stub the write with the book as the server returns it", async () => {
        const book = await ebooksRequests.getEbook(uuid);
        await expect(book).toBeOK();
        await metadataEditPage.stubCoverFromUrl(await book.json());
      });

      await test.step("apply the Google Books cover", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await fetchView.choose(["Cover"]);
        await fetchView.apply();
      });

      // A cover alone lands on Artwork, held, and nothing is written yet.
      await test.step("check the cover is held for Done", async () => {
        await expect(form.coverHintText).toHaveText(
          "from the web · fetched when you press Done",
        );
        await expect(form.editedSummary(1)).toBeVisible();
        expect(writes).toEqual([]);
      });

      await test.step("save", async () => {
        await expectMutation(covers.fromUrl(uuid, PIXEL), () => form.save());
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    test("surface a refused cover without dropping it", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { form, fetchView } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("stub the server refusing the cover's host", async () => {
        await metadataEditPage.stubCoverFromUrlRefused();
      });

      await test.step("apply the Google Books cover", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await fetchView.pickEdition("google-books");
        await fetchView.choose(["Cover"]);
        await fetchView.apply();
      });

      await test.step("save", async () => {
        await expectMutation(covers.fromUrlRefused(uuid), () => form.save());
      });

      await test.step("check the refusal shows and the cover is still held", async () => {
        await metadataEditPage.assertDisplayedFor(uuid);
        await expect(form.saveError).toContainText("Cover not saved");
        await expect(form.saveError).toContainText(
          "host is not an allowed source",
        );
        await expect(form.coverHintText).toHaveText(
          "from the web · fetched when you press Done",
        );
        await expect(form.editedSummary(1)).toBeVisible();
      });
    });
  });
});
