// Cross-format resume prompts and the unified Continue hero, on the reserved
// "Parallel Latitudes" pair (see fixtures/dual_format.ts). It writes progress
// and confirms a link, so no other spec may touch the book.

// Serial: every test links and unlinks the same reserved pair.

import { crossFormat } from "../contracts/crossFormat";
import { progress } from "../contracts/progress";
import { AUDIOBOOK_BOOK_COUNT } from "../fixtures/audiobooks";
import { AUTO_ATTACHED_PAIRS } from "../fixtures/dual_format";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

test.describe("cross-format resume prompts", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed both libraries", async ({ request }) => {
    test.setTimeout(120_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      FIXTURE_BOOKS.length + AUDIOBOOK_BOOK_COUNT - AUTO_ATTACHED_PAIRS,
    );
  });

  // The fixture unlinks the pair after each test, so each one confirms it
  // afresh. That also turns follow on, the state every test starts from.
  test.beforeEach(
    "link the reserved pair",
    async ({ crossFormatRequests, resumePromptUuid, linkedBookUuids }) => {
      const linked = await crossFormatRequests.postLink(resumePromptUuid);
      await expect(linked, "link confirm").toBeOK();
      linkedBookUuids.add(resumePromptUuid);
    },
  );

  test("resolve a linked book silently on the player", async ({
    listenPage,
    progressRequests,
    resumePromptUuid: uuid,
    eventClock,
  }) => {
    // Reading ahead at 50% of the text maps to ~1s of the 2-second fixture,
    // so the seek slider must boot past 0 with no prompt card anywhere.
    await test.step("read ahead of the audio", async () => {
      const audio = await progressRequests.postAudioPosition(
        uuid,
        0,
        eventClock.next(),
      );
      await expect(audio, "audio progress write").toBeOK();
      const epub = await progressRequests.postEpubPercent(
        uuid,
        50,
        eventClock.next(),
      );
      await expect(epub, "epub progress write").toBeOK();
    });

    await test.step("open the player", async () => {
      await listenPage.goto(uuid);
    });

    await test.step("check the boot seeded the mapped position without a prompt", async () => {
      await expect(listenPage.syncHereButton).toBeVisible();
      await expect(listenPage.removedSyncPrompt).toHaveCount(0);
      await expect
        .poll(() => listenPage.seekPosition(), {
          timeout: 15_000,
          message: "the boot should seed the mapped (non-zero) position",
        })
        .toBeGreaterThan(0);
    });
  });

  test("show one synced card with the counterpart affordance on the continue stack", async ({
    libraryPage,
    epubReaderPage,
    progressRequests,
    readStatusRequests,
    resumePromptUuid: uuid,
    eventClock,
  }) => {
    const { continueStack } = libraryPage;

    // The stack drops finished books and the 2-second fixture MP3 finishes on
    // any playback, so reset, re-stamp and reload until the card lands. The
    // clock is re-anchored because parallel specs stamp wall-clock positions.
    await test.step("reopen the library until the book's card lands", async () => {
      eventClock.reanchor();
      await expect
        .poll(
          async () => {
            const reset = await readStatusRequests.putReadStatus(
              uuid,
              "reading",
            );
            await expect(reset, "read-status reset").toBeOK();
            const epub = await progressRequests.postEpubPercent(
              uuid,
              80,
              eventClock.next(),
            );
            await expect(epub, "epub progress write").toBeOK();
            await libraryPage.goto();
            return continueStack.showsCard(uuid);
          },
          { timeout: 45_000, intervals: [1_000] },
        )
        .toBe(true);
      await expect(continueStack.card(uuid)).toHaveCount(1);
    });

    // The affordances describe the book out front, so a parallel spec's newer
    // position may have to be moved behind it.
    await test.step("bring the card to the front of the fan", async () => {
      await continueStack.bringForward(uuid);
      await expect(continueStack.card(uuid)).toHaveClass(/\blead\b/);
    });

    // The stack has no per-card eyebrow, so the synced state is reported once,
    // on the front book's byline.
    await test.step("check the front card is synced and offers the counterpart", async () => {
      await expect(continueStack.root).toContainText("synced");
      await expect(continueStack.crossFormatChip(uuid)).toBeVisible();
      await expect(continueStack.immersiveChip(uuid)).toBeVisible();
    });

    // Same handler as the book-detail CTA; immersive.spec covers the dock.
    await test.step("open the reader with the audiobook docked", async () => {
      await continueStack.openImmersive(uuid);
      await epubReaderPage.assertDisplayedFor(uuid);
    });
  });

  test("show the newest-format progress row above the sync chip", async ({
    bookDetailPage,
    resumePromptUuid: uuid,
  }) => {
    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // One position ruler for the book plus the linked readout naming the
    // audio-timeline hand-off.
    await test.step("check the ruler and the linked readout show", async () => {
      await expect(bookDetailPage.progressRuler).toBeVisible();
      await expect(bookDetailPage.syncLink.manageButton).toBeVisible();
      await expect(bookDetailPage.syncLink.linkedSummary).toBeVisible();
    });
  });

  test("apply a declared sync point when the reader opens", async ({
    epubReaderPage,
    listenPage,
    progressRequests,
    resumePromptUuid: uuid,
    eventClock,
    newestStoredClock,
    expectMutation,
  }) => {
    // The live failure was the restore settle chain yanking the view off the
    // follow jump, and that chain only engages for a stored CFI restore. A
    // percent-only row skips it.
    await test.step("turn a page to store a real position", async () => {
      await epubReaderPage.goto(uuid);
      await expectMutation(progress.save(), () => epubReaderPage.turnPage());
    });

    // Wall-clock writes outrank this file's synthetic clocks at the resume
    // gate. Anchoring on a clock near wall time would let the server clamp
    // later writes onto one clock, so wait it out and anchor behind it.
    await test.step("move the clock past the position just stored", async () => {
      const newest = await newestStoredClock(uuid);
      await expect
        .poll(() => Math.floor(Date.now() / 1000), { timeout: 15_000 })
        .toBeGreaterThan(newest + 3);
      eventClock.reanchor();
    });

    await test.step("listen ahead of the reading position", async () => {
      const audio = await progressRequests.postAudioPosition(
        uuid,
        1,
        eventClock.next(),
      );
      await expect(audio, "audio progress write").toBeOK();
    });

    await test.step("declare a sync point from the player", async () => {
      await listenPage.goto(uuid);
      await expectMutation(crossFormat.syncPoint(), () =>
        listenPage.declareSyncPoint(),
      );
      await expect(listenPage.syncHereButton).toContainText("Synced");
    });

    await test.step("listen past the declared pair and open the reader", async () => {
      const audio = await progressRequests.postAudioPosition(
        uuid,
        2,
        eventClock.next(),
      );
      await expect(audio, "audio progress write").toBeOK();
      await epubReaderPage.goto(uuid);
    });

    // The jump fires before epub.js locations resolve, so this exercises the
    // glue's pending-jump path. A silently dropped jump also shows no banner,
    // so the footer's whole-book percent is the proof (audio at end → ~100%).
    await test.step("check the reader opened at the mapped spot", async () => {
      await expect(epubReaderPage.footerBar).toContainText(
        /(8[6-9]|9\d|100)%/,
        { timeout: 20_000 },
      );
    });
  });

  test("offer linking when a sync point is refused whatever the server says", async ({
    listenPage,
    resumePromptUuid: uuid,
    expectMutation,
  }) => {
    // Only the message differs from the server's, so the label has to come
    // from the refusal code alone.
    await test.step("open the player while sync points are refused", async () => {
      await listenPage.stubSyncPointRefusal();
      await listenPage.goto(uuid);
    });

    await test.step("declare a sync point", async () => {
      await expectMutation(failing(crossFormat.syncPoint()), () =>
        listenPage.declareSyncPoint(),
      );
    });

    await test.step("check the pill offers linking", async () => {
      await expect(listenPage.syncHereButton).toHaveText("Link formats first");
    });
  });

  test("turn the jumps off with the follow switch without discarding the alignment", async ({
    bookDetailPage,
    resumePromptUuid: uuid,
    expectMutation,
  }) => {
    const { syncLink } = bookDetailPage;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    await test.step("turn follow off", async () => {
      await expectMutation(crossFormat.follow(uuid, false), () =>
        syncLink.toggleFollow(),
      );
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    // Off is not a disguised unlink (AC2): the confirmed link survives, so the
    // line still reads linked and offers Manage, not the unlinked nudge.
    await test.step("check the link survives", async () => {
      await expect(syncLink.linkedSummary).toBeVisible();
      await expect(syncLink.manageButton).toBeVisible();
      await expect(syncLink.linkFormatsButton).toHaveCount(0);
    });

    await test.step("turn follow back on", async () => {
      await expectMutation(crossFormat.follow(uuid, true), () =>
        syncLink.toggleFollow(),
      );
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });

  test("surface a failed follow flip and leave the switch where it was", async ({
    bookDetailPage,
    resumePromptUuid: uuid,
    expectMutation,
  }) => {
    const { syncLink } = bookDetailPage;

    await test.step("open the book while follow flips fail", async () => {
      await bookDetailPage.goto(uuid);
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await bookDetailPage.forceServerError(crossFormat.follow(uuid, false));
    });

    await test.step("turn follow off", async () => {
      await expectMutation(failing(crossFormat.follow(uuid, false)), () =>
        syncLink.toggleFollow(),
      );
    });

    await test.step("check the error shows and the switch stays on", async () => {
      await expect(syncLink.followError).toBeVisible();
      // Visible is not enough: the message has to read as a failure. Its class
      // is the only thing that colours it, and the obvious `bdmq-syncline-warn`
      // exists solely as a compound selector on the line itself.
      await expect(syncLink.followError).toHaveClass(/bdmq-syncerr/);
      // The write never landed, so the switch must not claim it did.
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });

  // The flip's acknowledged value stands in while the alignment re-read fails,
  // and must expire on the next view that LANDS, not one whose value agrees.
  // One scenario rather than two: the stand-in exists only in the flipping page.
  test("keep the switch on the value the server took until a fresher alignment lands", async ({
    bookDetailPage,
    resumePromptUuid: uuid,
    expectMutation,
  }) => {
    const { syncLink, alignmentModal } = bookDetailPage;

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    await test.step("turn follow off while the alignment re-read fails", async () => {
      await bookDetailPage.forceServerError(crossFormat.alignment());
      await expectMutation(crossFormat.follow(uuid, false), () =>
        syncLink.toggleFollow(),
      );
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    // Confirming the alignment re-arms follow, so once that fresh view lands
    // the switch must follow the server back to on rather than hold what it
    // wrote.
    await test.step("confirm the alignment again", async () => {
      await bookDetailPage.stopForcingServerError(crossFormat.alignment());
      await syncLink.manageAlignment();
      await expectMutation(crossFormat.link(), () => alignmentModal.confirm());
      await expect(syncLink.followSwitch).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });
});
