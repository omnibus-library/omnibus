import { covers } from "../contracts/covers";
import { metadata } from "../contracts/metadata";
import { overrides } from "../contracts/overrides";
import {
  ALL_CONFIGURED,
  type EditionSearchQuery,
  FOUND,
  GB_ANSWERED,
  GB_CANDIDATE,
  GB_ROW,
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

// Every provider response is stubbed: the suite must never depend on a live
// provider or a configured key, and a fan-out would spend three real calls per test.
//
// `mathematica-minor-2` ("Minor Lemmas II") is read by no other spec: one test
// saves a real override on it and reverts it.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "mathematica-minor-2")!;

const ISBN = "9781234567897";

test.describe("metadata edit edition picker", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the edition picker layout", async ({
    metadataEditPage,
    request,
  }) => {
    const overlay = metadataEditPage.searchOverlay;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the edit page with every provider configured", async () => {
      await overlay.stubEditionLookup(STANDARD_ANSWERS);
      await metadataEditPage.goto(uuid);
    });

    await test.step("check the picker is offered but closed", async () => {
      await metadataEditPage.assertDisplayed();
      await metadataEditPage.topNav.assertDisplayed();
      await expect(overlay.openButton).toBeVisible();
      await expect(overlay.root).toHaveCount(0);
    });

    const searches = await test.step("open the picker", async () => {
      const sent = overlay.recordSearches();
      await overlay.open();
      await expect(overlay.root).toBeVisible();
      return sent;
    });

    // Nothing is searched until the reader presses Search, so they can see an ISBN's narrowing first.
    await test.step("check it is seeded from the book without searching", async () => {
      await expect(overlay.titleQueryField).toHaveValue(TARGET.title);
      await expect(overlay.authorQueryField).toHaveValue(TARGET.authors[0]!);
      await expect(overlay.readyNote).toBeVisible();
      await expect(overlay.candidateList).toHaveCount(0);
      expect(searches, "the overlay must not search on open").toHaveLength(0);
    });

    await test.step("search when asked", async () => {
      await overlay.search();
      await expect(overlay.candidateList).toBeVisible();
    });
  });

  test.describe("query", () => {
    // The ISBN is the exact question, so the form's value narrows every source to one edition.
    test("send the book's ISBN with the search", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      // The book has no ISBN, so one is typed into the form: the picker seeds from it, and nothing is saved.
      await test.step("put an ISBN in the form and open the picker", async () => {
        await overlay.stubEditionLookup(STANDARD_ANSWERS);
        await metadataEditPage.goto(uuid);
        await metadataEditPage.form.enterIsbn13(ISBN);
        await overlay.open();
        await expect(overlay.isbnQueryField).toHaveValue(ISBN);
      });

      await test.step("search", async () => {
        const { request: sent } = await expectMutation(metadata.search(), () =>
          overlay.search(),
        );
        const { req }: { req: EditionSearchQuery } = sent.postDataJSON();
        expect(req.isbn).toBeTruthy();
      });
    });

    test("widen the search by clearing the ISBN", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("put an ISBN in the form and open the picker", async () => {
        await overlay.stubEditionLookup(STANDARD_ANSWERS);
        await metadataEditPage.goto(uuid);
        await metadataEditPage.form.enterIsbn13(ISBN);
        await overlay.open();
        await expect(overlay.isbnQueryField).toHaveValue(ISBN);
      });

      await test.step("clear the ISBN and search", async () => {
        await overlay.enterQuery({ isbn: "" });
        const { request: sent } = await expectMutation(metadata.search(), () =>
          overlay.search(),
        );
        const { req }: { req: EditionSearchQuery } = sent.postDataJSON();
        expect(req.isbn ?? null).toBeNull();
        expect(req.title).toBe(TARGET.title);
      });
    });

    // Any keystroke used to collapse the three fields into one phrase that Open Library matched against titles alone.
    test("send each query field as itself", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("edit all three fields and search again", async () => {
        await overlay.enterQuery({
          title: "Minor Lemmas",
          author: "Germain",
          isbn: ISBN,
        });
        const { request: sent } = await expectMutation(metadata.search(), () =>
          overlay.search(),
        );
        const { req }: { req: EditionSearchQuery } = sent.postDataJSON();
        expect(req.title).toBe("Minor Lemmas");
        expect(req.author).toBe("Germain");
        expect(req.isbn).toBe(ISBN);
      });
    });

    // An ISBN is the strongest question any provider takes, and one box could not express it.
    test("search on an ISBN alone", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("keep only the ISBN", async () => {
        await overlay.enterQuery({ title: "", author: "", isbn: ISBN });
        await expect(overlay.searchButton).toBeEnabled();
      });

      await test.step("search", async () => {
        const { request: sent } = await expectMutation(metadata.search(), () =>
          overlay.search(),
        );
        const { req }: { req: EditionSearchQuery } = sent.postDataJSON();
        expect(req.isbn).toBe(ISBN);
        expect(req.title ?? null).toBeNull();
      });
    });

    test("disable the search until a field has something in it", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("empty every field", async () => {
        await overlay.enterQuery({ title: "", author: "", isbn: "" });
        await expect(overlay.searchButton).toBeDisabled();
      });

      await test.step("fill one back in", async () => {
        await overlay.enterQuery({ author: "Germain" });
        await expect(overlay.searchButton).toBeEnabled();
      });
    });
  });

  test.describe("closing", () => {
    test("close the picker with its close button", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("close it", async () => {
        await overlay.close();
        await expect(overlay.root).toHaveCount(0);
      });
    });

    test("close the picker by clicking outside it", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the picker", async () => {
        await overlay.stubEditionLookup({ catalog: ALL_CONFIGURED });
        await metadataEditPage.goto(uuid);
        await overlay.open();
        await expect(overlay.root).toBeVisible();
      });

      await test.step("click the scrim", async () => {
        await overlay.closeByClickingOutside();
        await expect(overlay.root).toHaveCount(0);
      });
    });
  });

  test.describe("results", () => {
    test("list a candidate per source with cover, title, authors and origin", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("check the first candidate", async () => {
        await expect(overlay.candidateTitle(0)).toHaveText(OL_CANDIDATE.title);
        await expect(overlay.candidateAuthors(0)).toHaveText("Sophie Germain");
        await expect(overlay.candidateImprint(0)).toHaveText(
          "1815 · Klein Mathematik · 9781234567897",
        );
        await expect(overlay.candidateSource(0)).toHaveText("Open Library");
        await expect(overlay.candidateCover(0)).toBeVisible();
      });

      await test.step("check the same ISBN under a second source stays its own row", async () => {
        await expect(overlay.candidateTitle(1)).toHaveText(GB_CANDIDATE.title);
        await expect(overlay.candidateSource(1)).toHaveText("Google Books");
      });
    });

    // The stub answers Google Books first; a slow or newly configured provider must not reshuffle the rows.
    test("order candidates by the editions themselves, not by who answered", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("check the title that sorts first leads", async () => {
        await expect(overlay.candidateSource(0)).toHaveText("Open Library");
        await expect(overlay.candidateSource(1)).toHaveText("Google Books");
      });
    });

    // A short list has several causes and they are not interchangeable.
    test("say what every source contributed, including the ones that did not", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
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
        await expect(overlay.sourceNote("open-library")).toHaveText(
          "Open Library 1",
        );
        await expect(overlay.sourceNote("google-books")).toHaveText(
          "Google Books nothing",
        );
        await expect(overlay.sourceNote("hardcover")).toHaveText(
          "Hardcover unavailable",
        );
        // The provider's own message is there without the line becoming an error log.
        await expect(overlay.sourceNote("hardcover")).toHaveAttribute(
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
      const overlay = metadataEditPage.searchOverlay;
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
        await expect(overlay.sourceNote("hardcover")).toHaveText(
          "Hardcover rate limited, skipping for 10m",
        );
        await expect(overlay.sourceNote("hardcover")).toHaveAttribute(
          "title",
          /rate-limited us recently/,
        );
      });
    });

    // A work-level search hit, as Hardcover's `search` returns, has no year, publisher or edition ISBN.
    test("keep the row of a candidate that names no printing", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search while a candidate names no printing", async () => {
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

      await test.step("check its row still has three lines", async () => {
        await expect(overlay.candidateTitle(0)).toHaveText(OL_CANDIDATE.title);
        await expect(overlay.candidateImprint(0)).toHaveText("—");
      });
    });

    test("report a provider with no key as not set up", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search every configured provider", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await expect(overlay.candidateList).toBeVisible();
      });

      await test.step("check the unkeyed provider reads as not set up", async () => {
        await expect(overlay.sourceNote("hardcover")).toHaveText(
          "Hardcover not set up",
        );
      });
    });

    test("show a search failure and leave the form values alone", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search while the server fails the search", async () => {
        await metadataEditPage.forceServerError(metadata.search());
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
        });
      });

      await test.step("check the error shows without candidates", async () => {
        await expect(overlay.errorMessage).toBeVisible();
        await expect(overlay.candidateList).toHaveCount(0);
      });

      await test.step("close the picker and check the form never moved", async () => {
        await overlay.close();
        await expect(form.titleField).toHaveValue(TARGET.title);
        await expect(form.saveButton).toBeDisabled();
      });
    });

    test("hide the entry point when no provider is configured", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the edit page with no provider configured", async () => {
        await overlay.stubEditionLookup({ catalog: NONE_CONFIGURED });
        await metadataEditPage.goto(uuid);
      });

      await test.step("check the picker is not offered", async () => {
        await expect(overlay.openButton).toHaveCount(0);
      });
    });
  });

  test.describe("compare", () => {
    test("show only the fields the source would change", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
      });

      await test.step("check the rows that differ", async () => {
        await expect(compare.sourceName).toHaveText("Google Books");
        await expect(compare.rowSource("title")).toHaveText(GB_CANDIDATE.title);
        await expect(compare.rowSource("publisher")).toHaveText(
          "Editions Gauss",
        );
      });

      // A source with no series cannot change one, and a row that cannot be applied is only noise.
      await test.step("check the rows it cannot change are absent", async () => {
        await expect(compare.row("series")).toHaveCount(0);
        await expect(compare.row("genres")).toHaveCount(0);
      });

      await test.step("check looking staged nothing", async () => {
        await expect(form.saveButton).toBeDisabled();
      });
    });

    test("toggle the unchanged fields", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
        await expect(compare.row("series")).toHaveCount(0);
      });

      // The source has nothing to offer, and not knowing a field must never blank a value you have.
      await test.step("reveal the fields the source leaves alone", async () => {
        await compare.toggleUnchanged();
        await expect(compare.rowSource("series")).toHaveText("—");
        await expect(compare.applyButton("series")).toBeDisabled();
        await expect(compare.rowCurrent("series")).toHaveText(TARGET.series!);
      });

      await test.step("hide them again", async () => {
        await compare.toggleUnchanged();
        await expect(compare.row("series")).toHaveCount(0);
      });
    });

    test("copy one field into the form", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
        await expect(compare.rowCurrent("publisher")).toHaveText(
          TARGET.publisher!,
        );
      });

      await test.step("copy the publisher", async () => {
        await compare.apply("publisher");
        await expect(form.publisherField).toHaveValue("Editions Gauss");
        await expect(form.titleField).toHaveValue(TARGET.title);
      });

      // The row stays and its control becomes the way back, rather than vanishing under the cursor.
      await test.step("check the row stays in place, staged", async () => {
        await expect(compare.row("publisher")).toHaveAttribute(
          "data-staged",
          "true",
        );
        await expect(compare.applyButton("publisher")).toHaveCount(0);
        await expect(compare.undoButton("publisher")).toBeVisible();
        await expect(compare.rowCurrent("publisher")).toHaveText(
          "Editions Gauss",
        );
      });

      // Staged only: the save bar counts it and no write went out.
      await test.step("check the save bar counts the edit", async () => {
        await expect(form.saveButton).toBeEnabled();
        await expect(form.editedSummary(1)).toBeVisible();
      });
    });

    test("undo a staged field", async ({ metadataEditPage, request }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("copy the publisher from the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
        await compare.apply("publisher");
        await expect(form.publisherField).toHaveValue("Editions Gauss");
      });

      await test.step("undo it", async () => {
        await compare.undo("publisher");
      });

      // The row's control says which state it is in: it offers to take the value again.
      await test.step("check the book's own value is back", async () => {
        await expect(form.publisherField).toHaveValue(TARGET.publisher!);
        await expect(compare.row("publisher")).toHaveAttribute(
          "data-staged",
          "false",
        );
        await expect(compare.applyButton("publisher")).toBeVisible();
        await expect(form.saveButton).toBeDisabled();
      });
    });

    // The retired one-provider panel set title, authors, description, series, book # and ISBN-13.
    test("offer every field the retired Hardcover panel could apply", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("search with Hardcover configured", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: HC_CONFIGURED,
          found: HC_FOUND,
        });
        // Hardcover is a source in its own right, not a "not set up" row.
        await expect(overlay.sourceNote("hardcover")).toHaveText(/Hardcover/);
      });

      await test.step("compare the Hardcover candidate", async () => {
        await overlay.pickCandidate(0);
        await expect(compare.root).toBeVisible();
      });

      await test.step("check all six fields can be applied", async () => {
        for (const slug of [
          "title",
          "author-s-",
          "description",
          "series",
          "book--",
          "isbn-13",
        ]) {
          await expect(compare.row(slug)).toBeVisible();
          await expect(compare.applyButton(slug)).toBeEnabled();
        }
      });

      // Book # is the arm the retirement had to add: the panel could set one and the picker had no field for it.
      await test.step("apply the book number", async () => {
        await compare.apply("book--");
        await expect(form.bookNumberField).toHaveValue(
          HC_CANDIDATE.series_index!,
        );
      });
    });

    test("take every change at once and skip what the source lacks", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
      });

      await test.step("take all", async () => {
        await compare.takeAll();
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

      // Google Books offered no series, so take-all skips it rather than blanking the book's own.
      await test.step("check what the source lacks is kept and nothing is left to take", async () => {
        await expect(form.seriesField).toHaveValue(TARGET.series!);
        await expect(compare.takeAllButton).toBeDisabled();
      });
    });

    test("keep a staged apply across a trip back to the results", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("copy the publisher from the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
        await compare.apply("publisher");
      });

      await test.step("go back to the results", async () => {
        await compare.back();
        await expect(overlay.candidateList).toBeVisible();
        await expect(compare.root).toHaveCount(0);
      });

      // The compare screen writes into the page's form signals, which outlive the overlay.
      await test.step("check the apply is still staged", async () => {
        await expect(form.publisherField).toHaveValue("Editions Gauss");
        await expect(form.editedSummary(1)).toBeVisible();
      });

      await test.step("close the picker and check the apply survives it", async () => {
        await overlay.close();
        await expect(form.publisherField).toHaveValue("Editions Gauss");
      });
    });

    test("discard a staged apply on navigating away", async ({
      metadataEditPage,
      bookDetailPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("copy the publisher and finish the comparison", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
        await compare.apply("publisher");
        await compare.done();
        await expect(overlay.root).toHaveCount(0);
      });

      await test.step("discard the edits", async () => {
        await form.discard();
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      await test.step("reopen the form and check nothing was kept", async () => {
        await metadataEditPage.goto(uuid);
        await expect(form.publisherField).toHaveValue(TARGET.publisher!);
        await expect(form.saveButton).toBeDisabled();
      });
    });

    test("save exactly the applied values", async ({
      metadataEditPage,
      bookDetailPage,
      overriddenBookUuids,
      expectMutation,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      overriddenBookUuids.add(uuid);

      await test.step("copy the publisher and finish the comparison", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
        await compare.apply("publisher");
        await compare.done();
      });

      // The compare screen never talks to the overrides endpoint itself: the page's own save does.
      await test.step("save", async () => {
        await expectMutation(
          overrides.save({
            uuid,
            overrides: { publisher: "Editions Gauss" },
          }),
          () => form.save(),
        );
        await bookDetailPage.assertDisplayedFor(uuid);
      });

      // The title the source also offered was never taken, so it must not have been written.
      await test.step("reopen the form and check only the applied field persisted", async () => {
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

    test("hold the apply controls inert until the detail re-fetch lands", async ({
      metadataEditPage,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const detailDescription = "Only the detail record has this.";

      await test.step("search, then hold the re-fetch of the Open Library candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.holdHydrate();
        await overlay.pickCandidate(0);
      });

      // The search hit is a partial answer: showing it would have rows appear and rearrange a moment later.
      await test.step("check a placeholder shows instead of field rows", async () => {
        await expect(compare.hydratingNotice).toBeVisible();
        await expect(compare.skeleton).toBeVisible();
        await expect(compare.fields).toHaveCount(0);
        await expect(compare.takeAllButton).toBeDisabled();
      });

      await test.step("let the re-fetch land", async () => {
        overlay.releaseHydrate({
          ...OL_CANDIDATE,
          description: detailDescription,
        });
      });

      await test.step("check the description arrived and every control is live", async () => {
        await expect(compare.rowSource("description")).toHaveText(
          detailDescription,
        );
        await expect(compare.takeAllButton).toBeEnabled();
      });

      await test.step("take all", async () => {
        await compare.takeAll();
        await expect(form.descriptionField).toHaveValue(detailDescription);
      });
    });
  });

  test.describe("cover row", () => {
    test("offer the source's cover with an arrow labelled as an immediate change", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
      });

      // The row says so in words, not only in behaviour.
      await test.step("check the cover row", async () => {
        await expect(compare.coverRow).toBeVisible();
        await expect(compare.coverSourceImage).toBeVisible();
        await expect(compare.coverNote).toHaveText(
          "The cover applies immediately · it isn’t staged with the fields",
        );
        await expect(compare.applyButton("cover")).toHaveAttribute(
          "aria-label",
          /saves immediately/,
        );
      });
    });

    test("hide the cover row when the source has no cover to offer", async ({
      metadataEditPage,
      request,
    }) => {
      const overlay = metadataEditPage.searchOverlay;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("compare a candidate with no cover", async () => {
        await metadataEditPage.searchEditions(uuid, {
          catalog: ALL_CONFIGURED,
          found: {
            ...FOUND,
            editions: [{ ...OL_CANDIDATE, cover_url: null }],
          },
        });
        await overlay.pickCandidate(0);
        await expect(compare.coverRow).toHaveCount(0);
      });

      // Held to the same rule as every field row, so "show all" brings it back.
      await test.step("reveal the unchanged fields", async () => {
        await compare.toggleUnchanged();
        await expect(compare.applyButton("cover")).toBeDisabled();
      });
    });

    test("apply the source's cover at once", async ({
      metadataEditPage,
      bookDetailPage,
      overridesRequests,
      expectMutation,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("stub the write with the book as the server returns it", async () => {
        const book = await overridesRequests.getEbook(uuid);
        await expect(book).toBeOK();
        await metadataEditPage.stubCoverFromUrl(await book.json());
      });

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
      });

      await test.step("apply the cover", async () => {
        await expectMutation(covers.fromUrl(uuid, PIXEL), () =>
          compare.apply("cover"),
        );
      });

      // The write is immediate, so the bar reports it saved rather than "No changes", and Save stays the way out (#2241).
      await test.step("check the row and the save bar report it", async () => {
        await expect(compare.coverNote).toHaveText("Cover updated.");
        await expect(form.coverReplacedNote).toBeVisible();
        await expect(form.saveButton).toBeEnabled();
      });

      // The sidebar's cover controls and its "Override active" card are two components behind the overlay.
      await test.step("close the picker and check the sidebar follows without a reload", async () => {
        await overlay.close();
        await expect(form.removeCoverOverrideButton).toBeVisible();
        await expect(form.coverHintText).toHaveText("custom upload");
        await expect(metadataEditPage.revertButton).toBeVisible();
      });

      // With no field edited there is no diff to send, so Save is purely the exit.
      await test.step("save to leave the editor without a write", async () => {
        await form.save();
        await bookDetailPage.assertDisplayedFor(uuid);
      });
    });

    test("surface a refused cover without changing anything", async ({
      metadataEditPage,
      expectMutation,
      request,
    }) => {
      const { form, searchOverlay: overlay } = metadataEditPage;
      const { compare } = overlay;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("stub the server refusing the cover's host", async () => {
        await metadataEditPage.stubCoverFromUrlRefused();
      });

      await test.step("compare the Google Books candidate", async () => {
        await metadataEditPage.searchEditions(uuid, STANDARD_ANSWERS);
        await overlay.pickCandidate(GB_ROW);
        await expect(compare.root).toBeVisible();
      });

      await test.step("apply the cover", async () => {
        await expectMutation(covers.fromUrlRefused(uuid), () =>
          compare.apply("cover"),
        );
      });

      await test.step("check the refusal shows and nothing changed", async () => {
        await expect(compare.coverNote).toContainText(
          "Couldn't apply that cover",
        );
        await overlay.close();
        await expect(form.removeCoverOverrideButton).toHaveCount(0);
        await expect(form.saveButton).toBeDisabled();
      });
    });
  });
});
