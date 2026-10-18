import { cleanup } from "../contracts/cleanup";
import {
  AUTHOR_MERGE_CARD,
  CLEANUP_KINDS,
  TITLE_RENAME_CARD,
} from "../data/cleanup";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// The decide tests stub the queue: the real one is server state a parallel
// reindex can refill, and accepting a real suggestion would merge live rows.

test.describe("library cleanup section", () => {
  test("show the library cleanup layout", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    const { cleanup: section } = settingsPage;

    await test.step("open the library cleanup section", async () => {
      await expectMutation(cleanup.counts(), () =>
        settingsPage.goto("cleanup"),
      );
    });

    await test.step("check each kind lists its pending count", async () => {
      await expect(section.heading).toBeVisible();
      await expect(section.kinds).toBeVisible();
      for (const kind of CLEANUP_KINDS) {
        await expect(section.kind(kind)).toBeVisible();
        await expect(section.pendingCount(kind)).toContainText("pending");
      }
      await expect(section.detectButton).toBeVisible();
      await settingsPage.topNav.assertDisplayed();
    });

    await test.step("follow the author review link", async () => {
      await expectMutation(cleanup.queue("author"), () =>
        section.openReview("author"),
      );
    });

    // The shared server's real queue is either empty or holding cards.
    await test.step("check the review frame shows", async () => {
      await cleanupReviewPage.assertDisplayed();
      await expect(cleanupReviewPage.heading("Review authors")).toBeVisible();
      await expect(cleanupReviewPage.kindline).toBeVisible();
      for (const kind of CLEANUP_KINDS) {
        await expect(cleanupReviewPage.kindChip(kind)).toBeVisible();
      }
      await expect(
        cleanupReviewPage.emptyMessage.or(cleanupReviewPage.card),
      ).toBeVisible();
    });
  });

  test("queue a detection pass", async ({ settingsPage, expectMutation }) => {
    const { cleanup: section } = settingsPage;

    await test.step("open the library cleanup section", async () => {
      await settingsPage.goto("cleanup");
    });

    await test.step("run detection", async () => {
      await expectMutation(cleanup.detect(), () => section.runDetection());
    });

    await test.step("check the section says it started", async () => {
      await expect(section.detectStatus).toContainText("Detection started.");
    });
  });
});

test.describe("cleanup review", () => {
  test("show the empty state when no suggestions are pending", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    await test.step("open the author review with an empty queue", async () => {
      await cleanupReviewPage.stubQueue([]);
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("author"), () =>
        settingsPage.cleanup.openReview("author"),
      );
      await cleanupReviewPage.assertDisplayed();
    });

    await test.step("check no card shows", async () => {
      await expect(cleanupReviewPage.emptyMessage).toHaveText(
        "No suggestions pending.",
      );
      await expect(cleanupReviewPage.card).toHaveCount(0);
    });
  });

  test("accept a card with the Y hotkey", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    await test.step("open the author review with one card", async () => {
      await cleanupReviewPage.stubQueue([AUTHOR_MERGE_CARD]);
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("author"), () =>
        settingsPage.cleanup.openReview("author"),
      );
      await cleanupReviewPage.assertDisplayed();
    });

    await test.step("check the card reads left to right", async () => {
      await expect(cleanupReviewPage.card).toHaveCount(1);
      await expect(cleanupReviewPage.cardAction).toContainText(
        "Merge these authors into one.",
      );
      // The record folding away comes first, then the survivor.
      await expect(cleanupReviewPage.cardScanned).toHaveText(
        "Shelley, Mary W.",
      );
      await expect(cleanupReviewPage.cardProposed).toHaveText("Mary Shelley");
      await expect(cleanupReviewPage.cardBooks).toHaveText("3 books affected");
      // An author merge takes no arbitrary value, so its proposal isn't editable.
      await expect(cleanupReviewPage.proposalField).toHaveCount(0);
      await expect(cleanupReviewPage.progress).toContainText("1 of 1");
    });

    // The canned card names no real row, so the decide POST is stubbed too.
    await test.step("accept it with the hotkey", async () => {
      await cleanupReviewPage.stubDecisionsRecorded();
      // Arriving by the Review link creates the section after page load, so its
      // autofocus does nothing and the page must take focus itself.
      await expect(cleanupReviewPage.review).toBeFocused();
      await expectMutation(cleanup.decide(AUTHOR_MERGE_CARD, "accepted"), () =>
        cleanupReviewPage.acceptWithHotkey(),
      );
    });

    // The queue held one card, so the accepted card was the last.
    await test.step("check the queue is done", async () => {
      await expect(cleanupReviewPage.emptyMessage).toBeVisible();
    });
  });

  test("reject a card with the reject button", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    await test.step("open the author review with one card", async () => {
      await cleanupReviewPage.stubQueue([AUTHOR_MERGE_CARD]);
      await cleanupReviewPage.stubDecisionsRecorded();
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("author"), () =>
        settingsPage.cleanup.openReview("author"),
      );
      await cleanupReviewPage.assertDisplayed();
    });

    await test.step("reject the card", async () => {
      await expectMutation(cleanup.decide(AUTHOR_MERGE_CARD, "rejected"), () =>
        cleanupReviewPage.reject(),
      );
    });

    await test.step("check the queue is done", async () => {
      await expect(cleanupReviewPage.emptyMessage).toBeVisible();
    });
  });

  test("skip a card without deciding it", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    const second = {
      ...AUTHOR_MERGE_CARD,
      id: 4243,
      primary_name: "Bram Stoker",
      secondary_name: null,
      book_count: 1,
    };

    await test.step("open the author review with two cards", async () => {
      await cleanupReviewPage.stubQueue([AUTHOR_MERGE_CARD, second]);
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("author"), () =>
        settingsPage.cleanup.openReview("author"),
      );
      await cleanupReviewPage.assertDisplayed();
      await expect(cleanupReviewPage.cardProposed).toHaveText("Mary Shelley");
    });

    await test.step("skip the first card", async () => {
      await cleanupReviewPage.skip();
    });

    await test.step("check the second card shows", async () => {
      await expect(cleanupReviewPage.cardProposed).toHaveText("Bram Stoker");
      await expect(cleanupReviewPage.cardBooks).toHaveText("1 book affected");
    });
  });

  test("keep the card when the decide request fails", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    const decide = cleanup.decide(AUTHOR_MERGE_CARD, "accepted");

    await test.step("open the author review with one card", async () => {
      await cleanupReviewPage.stubQueue([AUTHOR_MERGE_CARD]);
      await settingsPage.forceServerError(decide);
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("author"), () =>
        settingsPage.cleanup.openReview("author"),
      );
      await cleanupReviewPage.assertDisplayed();
    });

    await test.step("accept the card", async () => {
      await expectMutation(failing(decide), () => cleanupReviewPage.accept());
    });

    await test.step("check the error shows and the queue stays put", async () => {
      await expect(cleanupReviewPage.errorMessage).toBeVisible();
      // The failed decision must not advance the queue.
      await expect(cleanupReviewPage.cardProposed).toHaveText("Mary Shelley");
    });
  });

  test("accept a book title with the reviewer's own wording", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    const wording = "Frankenstein; or, The Modern Prometheus";

    // The proposal is a field, and accepting takes what is in it. The decide
    // POST proves the edit reached the server; the card names no real row, so
    // it is stubbed.
    await test.step("open the book title review with one card", async () => {
      await cleanupReviewPage.stubQueue([TITLE_RENAME_CARD]);
      await cleanupReviewPage.stubDecisionsRecorded();
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("book_title"), () =>
        settingsPage.cleanup.openReview("book_title"),
      );
      await cleanupReviewPage.assertDisplayed();
      await expect(cleanupReviewPage.proposalField).toHaveValue("Frankenstein");
      await expect(cleanupReviewPage.editedTag).toHaveCount(0);
      await expect(cleanupReviewPage.acceptButton).toBeVisible();
    });

    // Typing over the proposal is announced, and Accept renames itself to say
    // what accepting would now write.
    await test.step("type over the proposal", async () => {
      await cleanupReviewPage.editProposal(wording);
      await expect(cleanupReviewPage.editedTag).toBeVisible();
      await expect(cleanupReviewPage.acceptEditedButton).toBeVisible();
    });

    await test.step("accept the edited title", async () => {
      await expectMutation(
        cleanup.decide(TITLE_RENAME_CARD, "accepted", wording),
        () => cleanupReviewPage.acceptEdited(),
      );
    });

    await test.step("check the tally counts the edit", async () => {
      await expect(cleanupReviewPage.emptyMessage).toBeVisible();
      await expect(cleanupReviewPage.tally).toContainText(
        "accepted with your wording",
      );
    });
  });

  // A title with a y, an n or a space must land in the field and not decide
  // the card out from under the reviewer.
  test("ignore the hotkeys while the proposal field has focus", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    await test.step("open the book title review with one card", async () => {
      await cleanupReviewPage.stubQueue([TITLE_RENAME_CARD]);
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("book_title"), () =>
        settingsPage.cleanup.openReview("book_title"),
      );
      await cleanupReviewPage.assertDisplayed();
    });

    await test.step("type a title containing hotkeys", async () => {
      await cleanupReviewPage.typeProposal("Mary yn Shelley");
    });

    await test.step("check the text landed and the card is undecided", async () => {
      await expect(cleanupReviewPage.proposalField).toHaveValue(
        "Mary yn Shelley",
      );
      await expect(cleanupReviewPage.card).toBeVisible();
    });
  });

  // Space on the end-of-pass screen used to keep incrementing the very tally
  // that screen reports.
  test("stop counting skips once the pass is worked through", async ({
    settingsPage,
    cleanupReviewPage,
    expectMutation,
  }) => {
    await test.step("open the book title review with one card", async () => {
      await cleanupReviewPage.stubQueue([TITLE_RENAME_CARD]);
      await settingsPage.goto("cleanup");
      await expectMutation(cleanup.queue("book_title"), () =>
        settingsPage.cleanup.openReview("book_title"),
      );
      await cleanupReviewPage.assertDisplayed();
    });

    await test.step("skip the only card", async () => {
      await cleanupReviewPage.skip();
      await expect(cleanupReviewPage.emptyMessage).toBeVisible();
      await expect(cleanupReviewPage.tally).toContainText("1");
    });

    await test.step("press space on the end-of-pass screen", async () => {
      await cleanupReviewPage.pressSpace();
      await cleanupReviewPage.pressSpace();
    });

    await test.step("check the skipped count stayed at one", async () => {
      await expect(cleanupReviewPage.tally).toContainText("skipped");
      await expect(cleanupReviewPage.tallyCounts).toHaveText(["1"]);
    });
  });
});
