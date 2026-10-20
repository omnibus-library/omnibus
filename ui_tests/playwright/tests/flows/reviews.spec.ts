import { readStatus } from "../contracts/readStatus";
import { reviews } from "../contracts/reviews";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Only this spec writes reviews on `code-quartet-1`: the household summary
// counts every reader's stars on the book, so another writer would move it.
const REVIEW_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "code-quartet-1")!;

const REVIEW_TEXT = "A clockwork of a book, wound tight to the last page.";
const NOTES_TEXT = "Reread the recursion chapter before book club.";

// The dot rail marks the stop in view with this class.
const ON_CLASS = /\bon\b/;

test.describe("book reviews", () => {
  // Every test writes the same reviews on one book, so they run in file order.
  test.describe.configure({ mode: "default" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the reviews layout", async ({
    bookDetailPage,
    request,
    presetReview,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("delete your review through the api", async () => {
      await presetReview(uuid, null);
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the stop and your empty card show", async () => {
      await bookDetailPage.topNav.assertDisplayed();
      await expect(bookDetailPage.sectionDot("Reviews")).toBeVisible();
      await expect(section.kicker).toHaveText("No reviews yet");
      await expect(section.starsGroup).toBeVisible();
      await expect(section.starsMeta).toHaveText("Not rated yet");
      await expect(section.writeButton).toHaveAccessibleName("Write review");
      await expect(section.deleteButton).toHaveCount(0);
      await expect(section.noOtherReviewsMessage).toBeVisible();
    });

    // One rating is not a household figure, so neither shows.
    await test.step("check no household summary shows", async () => {
      await expect(section.summary).toHaveCount(0);
      await expect(section.jumpLink).toHaveCount(0);
    });
  });

  test("rate a book and review it with private notes", async ({
    bookDetailPage,
    request,
    presetReview,
    storedReview,
    expectMutation,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("delete your review through the api", async () => {
      await presetReview(uuid, null);
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("rate it 4.5 stars", async () => {
      await expectMutation(reviews.update(uuid, { stars: 4.5 }), () =>
        section.rate(4.5),
      );
      await expect(section.starsMeta).toContainText("4.5 of 5");
      await expect(section.clearButton(4.5)).toBeVisible();
    });

    await test.step("write the review, its private notes and its spoiler flag", async () => {
      await section.openComposer();
      await expect(section.writeButton).toHaveCount(0);
      await section.writeText(REVIEW_TEXT);
      await section.writeNotes(NOTES_TEXT);
      await section.toggleSpoiler();
      await expectMutation(
        reviews.update(uuid, {
          body_md: REVIEW_TEXT,
          notes_md: NOTES_TEXT,
          spoiler: true,
        }),
        () => section.save(),
      );
    });

    await test.step("check the card shows the review and the notes", async () => {
      await expect(section.composer).toHaveCount(0);
      await expect(section.myText).toHaveText(REVIEW_TEXT);
      await expect(section.myNotes).toContainText(NOTES_TEXT);
      await expect(section.myNotes).toContainText("only you can see these");
      await expect(section.writeButton).toHaveAccessibleName("Edit review");
      await expect(section.deleteButton).toBeVisible();
      await expect(section.kicker).toHaveText("1 review · 1 rating");
    });

    // The flag is set in the editor alone; read mode shows no box for it.
    await test.step("check the card shows no spoiler checkbox", async () => {
      await expect(section.myReviewCheckboxes).toHaveCount(0);
    });

    await test.step("check the server stored every field", async () => {
      await expect
        .poll(() => storedReview(uuid), { message: "stored review" })
        .toMatchObject({
          stars: 4.5,
          body_md: REVIEW_TEXT,
          notes_md: NOTES_TEXT,
          spoiler: true,
        });
    });
  });

  test("flag an existing review as containing spoilers from the editor", async ({
    bookDetailPage,
    request,
    presetReview,
    storedReview,
    expectMutation,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("review the book through the api", async () => {
      await presetReview(uuid, { body_md: REVIEW_TEXT, spoiler: false });
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // A flag flipped on its own is still a change, so Save sends just it.
    await test.step("tick the spoiler flag alone and save", async () => {
      await section.openComposer();
      await expect(section.spoilerCheckbox).not.toBeChecked();
      await section.toggleSpoiler();
      await expectMutation(reviews.update(uuid, { spoiler: true }), () =>
        section.save(),
      );
    });

    await test.step("check the server stored the flag and kept the text", async () => {
      await expect(section.composer).toHaveCount(0);
      await expect
        .poll(() => storedReview(uuid), { message: "stored review" })
        .toMatchObject({ body_md: REVIEW_TEXT, spoiler: true });
    });

    await test.step("check the editor reopens with the flag ticked", async () => {
      await section.openComposer();
      await expect(section.spoilerCheckbox).toBeChecked();
    });
  });

  test("show your review to another reader without your private notes", async ({
    readerBookDetailPage,
    request,
    presetReview,
    presetReadStatus,
    readerExpectMutation,
  }) => {
    const { reviews: section } = readerBookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("review the book as the admin through the api", async () => {
      await presetReview(uuid, {
        stars: 4.5,
        body_md: REVIEW_TEXT,
        notes_md: NOTES_TEXT,
        spoiler: true,
      });
      await presetReview(uuid, null, "reader");
      await presetReadStatus(uuid, "unread", "reader");
    });

    await test.step("open the book as the reader", async () => {
      await readerBookDetailPage.goto(uuid);
    });

    await test.step("check the stars show and the spoiler stays hidden", async () => {
      await expect(section.otherReviewCards).toHaveCount(1);
      await expect(section.starsLabelled("4.5 out of 5 stars")).toBeVisible();
      await expect(section.spoilerVeil).toBeVisible();
      await expect(section.textInSection(REVIEW_TEXT)).toHaveCount(0);
    });

    await test.step("reveal the review", async () => {
      await section.revealSpoiler();
      await expect(section.otherReviewText).toHaveText(REVIEW_TEXT);
    });

    await test.step("check the private notes never reach the reader", async () => {
      await expect(section.textInSection(NOTES_TEXT)).toHaveCount(0);
      await expect(section.myNotes).toHaveCount(0);
    });

    // A second rating makes the household figures, refreshed in place.
    await test.step("rate it 3 stars as the reader", async () => {
      await readerExpectMutation(reviews.update(uuid, { stars: 3 }), () =>
        section.rate(3),
      );
    });

    await test.step("check the household summary shows", async () => {
      await expect(section.summary).toBeVisible();
      await expect(section.summaryAverage).toHaveText("3.8");
      await expect(section.summaryCount).toContainText("2 readers");
      await expect(section.jumpLink).toContainText("3.8 · 2 readers");
    });

    await test.step("jump to the reviews from the title", async () => {
      await readerBookDetailPage.jumpToSection("Home");
      await expect(readerBookDetailPage.sectionDot("Home")).toHaveClass(
        ON_CLASS,
      );
      await section.jumpToReviews();
      await expect(readerBookDetailPage.sectionDot("Reviews")).toHaveClass(
        ON_CLASS,
      );
    });
  });

  test("open a spoiler once the reader marks the book finished", async ({
    readerBookDetailPage,
    request,
    presetReview,
    presetReadStatus,
    readerExpectMutation,
  }) => {
    const { reviews: section } = readerBookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("review the book with spoilers through the api", async () => {
      await presetReview(uuid, { body_md: REVIEW_TEXT, spoiler: true });
      await presetReadStatus(uuid, "unread", "reader");
    });

    await test.step("open the book as the reader", async () => {
      await readerBookDetailPage.goto(uuid);
      await expect(section.spoilerVeil).toBeVisible();
    });

    await test.step("mark the book finished", async () => {
      await readerExpectMutation(readStatus.set(uuid, "finished"), () =>
        readerBookDetailPage.readStatus.mark("finished"),
      );
    });

    await test.step("check the review opens", async () => {
      await expect(section.spoilerVeil).toHaveCount(0);
      await expect(section.otherReviewText).toHaveText(REVIEW_TEXT);
    });
  });

  test("gather the readers who only rated into one row", async ({
    bookDetailPage,
    request,
    presetReview,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("rate the book 5 stars as the reader through the api", async () => {
      await presetReview(uuid, null);
      await presetReview(uuid, { stars: 5 }, "reader");
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the rating shows in the stars-only row", async () => {
      await expect(section.otherReviewCards).toHaveCount(0);
      await expect(section.starsOnlyItems).toHaveCount(1);
      await expect(section.starsLabelled("5 out of 5 stars")).toBeVisible();
    });
  });

  test("clear your stars and keep your review", async ({
    bookDetailPage,
    request,
    presetReview,
    storedReview,
    expectMutation,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("rate and review the book through the api", async () => {
      await presetReview(uuid, { stars: 4, body_md: REVIEW_TEXT });
      await presetReview(uuid, { stars: 3 }, "reader");
    });

    await test.step("open the book with the household summary", async () => {
      await bookDetailPage.goto(uuid);
      await expect(section.summary).toBeVisible();
    });

    await test.step("clear the stars", async () => {
      await expectMutation(reviews.update(uuid, { stars: null }), () =>
        section.clear(4),
      );
    });

    await test.step("check the review stays without stars", async () => {
      await expect(section.starsMeta).toHaveText("Not rated yet");
      await expect(section.myText).toHaveText(REVIEW_TEXT);
      await expect
        .poll(() => storedReview(uuid), { message: "stored review" })
        .toMatchObject({ stars: null, body_md: REVIEW_TEXT });
    });

    // One rating left is no household figure: the re-read drops the summary.
    await test.step("check the household summary goes", async () => {
      await expect(section.summary).toHaveCount(0);
      await expect(section.jumpLink).toHaveCount(0);
    });
  });

  test("delete your review", async ({
    bookDetailPage,
    request,
    presetReview,
    storedReview,
    expectMutation,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("rate, review and annotate the book through the api", async () => {
      await presetReview(uuid, {
        stars: 4,
        body_md: REVIEW_TEXT,
        notes_md: NOTES_TEXT,
      });
      await presetReview(uuid, { stars: 3 }, "reader");
    });

    await test.step("open the book with the household summary", async () => {
      await bookDetailPage.goto(uuid);
      await expect(section.summary).toBeVisible();
    });

    await test.step("delete the review", async () => {
      await section.openDeleteDialog();
      await expect(section.deleteDialog).toBeVisible();
      await expectMutation(reviews.delete(uuid), () => section.confirmDelete());
    });

    await test.step("check everything is gone", async () => {
      await expect(section.deleteDialog).toHaveCount(0);
      await expect(section.myText).toHaveCount(0);
      await expect(section.myNotes).toHaveCount(0);
      await expect(section.starsMeta).toHaveText("Not rated yet");
      await expect(section.deleteButton).toHaveCount(0);
      await expect(section.summary).toHaveCount(0);
      await expect
        .poll(() => storedReview(uuid), { message: "stored review" })
        .toBeNull();
    });
  });

  test("show an error when a rating fails to save", async ({
    bookDetailPage,
    request,
    presetReview,
    expectMutation,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("delete your review through the api", async () => {
      await presetReview(uuid, null);
    });

    await test.step("open the book while saves fail", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.forceServerError(reviews.update(uuid, { stars: 3 }));
    });

    await test.step("rate it 3 stars", async () => {
      await expectMutation(failing(reviews.update(uuid, { stars: 3 })), () =>
        section.rate(3),
      );
    });

    // The drawn pick rolls back and the line beside the stars says why.
    await test.step("check the rating reports the failure", async () => {
      await expect(section.starsMeta).toHaveText(
        "Couldn’t save your rating — try again",
      );
      await expect(section.clearButton(3)).toHaveCount(0);
    });
  });

  test("keep the draft when a review fails to save", async ({
    bookDetailPage,
    request,
    presetReview,
    expectMutation,
  }) => {
    const { reviews: section } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, REVIEW_BOOK.title);

    await test.step("delete your review through the api", async () => {
      await presetReview(uuid, null);
    });

    await test.step("open the book while saves fail", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.forceServerError(
        reviews.update(uuid, { body_md: REVIEW_TEXT }),
      );
    });

    await test.step("write and save a review", async () => {
      await section.openComposer();
      await section.writeText(REVIEW_TEXT);
      await expectMutation(
        failing(reviews.update(uuid, { body_md: REVIEW_TEXT })),
        () => section.save(),
      );
    });

    await test.step("check the composer keeps the draft and says why", async () => {
      await expect(section.composerError).toBeVisible();
      await expect(section.textEditor).toHaveText(REVIEW_TEXT);
      await expect(section.myText).toHaveCount(0);
    });
  });
});
