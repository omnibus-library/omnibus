// The household reader picker on /stats. It runs as the worker's two readers,
// never the shared admin, whose share_stats flag account.spec.ts reads as "on".

import { account } from "../contracts/account";
import { stats } from "../contracts/stats";
import { TARGET_BOOK_TITLE } from "../data/stats";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/readerFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

const NOT_SHARING = "This reader isn't sharing their stats";

test.describe("household stats", () => {
  // The target's sharing is one reader's state, so the tests stay on one worker.
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the stats page layout with a picker listing the sharing target", async ({
    statsPage,
    householdTarget,
  }) => {
    await test.step("open the stats page", async () => {
      await statsPage.goto();
    });

    await test.step("check the page shows your own empty stats", async () => {
      await statsPage.assertDisplayed();
      await statsPage.topNav.assertDisplayed();
      await expect(statsPage.readerPicker.trigger).toHaveAttribute(
        "aria-label",
        "Stats for You",
      );
      await expect(statsPage.heroWho).toHaveCount(0);
      await expect(statsPage.emptyState).toBeVisible();
    });

    // The options sit in the DOM while the menu is hidden, so a layout test
    // reads them without opening it.
    await test.step("check the picker lists you and the target", async () => {
      const picker = statsPage.readerPicker;
      await expect(picker.option("you")).toContainText("You");
      await expect(picker.optionAvatar("you")).toHaveCount(1);
      await expect(picker.option(householdTarget.id)).toContainText(
        householdTarget.username,
      );
      await expect(picker.optionAvatar(householdTarget.id)).toHaveCount(1);
    });
  });

  test("pick the sharing target from the picker", async ({
    statsPage,
    householdTarget,
  }) => {
    await test.step("open the picker", async () => {
      await statsPage.goto();
      await statsPage.readerPicker.open();
      await expect(statsPage.readerPicker.menu).toBeVisible();
    });

    await test.step("choose the target", async () => {
      await statsPage.readerPicker.choose(householdTarget.id);
      await statsPage.assertDisplayedFor(householdTarget.id);
    });

    await test.step("check their figures show under a third-person heading", async () => {
      await expect(statsPage.heroWho).toHaveText(
        `${householdTarget.username}'s stats`,
      );
      await expect(statsPage.emptyState).toHaveCount(0);
      await expect(statsPage.inProgress).toContainText(TARGET_BOOK_TITLE);
      await expect(statsPage.goalSetLink).toHaveCount(0);
      await expect(statsPage.dailySetLink).toHaveCount(0);
    });
  });

  test("query the target's stats for the selected period", async ({
    statsPage,
    householdTarget,
    expectMutation,
  }) => {
    await test.step("open the target's stats", async () => {
      await statsPage.goto(householdTarget.id);
    });

    // user_id follows the route's ?user=, not the caller.
    await test.step("select the year pill", async () => {
      await expectMutation(stats.summary("year", householdTarget.id), () =>
        statsPage.selectPeriod("year"),
      );
    });
  });

  // The SSR half of ?user= has to agree with the hydrated one.
  test("load the target's stats from a direct link", async ({
    statsPage,
    householdTarget,
  }) => {
    await test.step("open the target's stats by url", async () => {
      await statsPage.goto(householdTarget.id);
    });

    await test.step("check the page reads as the target's", async () => {
      await expect(statsPage.heroWho).toHaveText(
        `${householdTarget.username}'s stats`,
      );
      await expect(statsPage.readerPicker.trigger).toHaveAttribute(
        "aria-label",
        `Stats for ${householdTarget.username}`,
      );
    });
  });

  test("open the library scope while viewing the target", async ({
    statsPage,
    householdTarget,
  }) => {
    await test.step("open the target's stats", async () => {
      await statsPage.goto(householdTarget.id);
    });

    await test.step("open the library scope", async () => {
      await statsPage.openLibraryScope();
      await expect(statsPage.libraryScope).toBeVisible();
    });
  });

  test("return to your own stats from the picker", async ({
    statsPage,
    householdTarget,
  }) => {
    await test.step("open the target's stats", async () => {
      await statsPage.goto(householdTarget.id);
    });

    await test.step("choose you", async () => {
      await statsPage.readerPicker.pick("you");
    });

    await test.step("check your own page shows", async () => {
      await statsPage.assertDisplayed();
      await expect(statsPage.emptyState).toBeVisible();
      await expect(statsPage.heroWho).toHaveCount(0);
    });
  });

  test("keep the target's in-progress card when the previous reader's fetch lands late", async ({
    statsPage,
    householdTarget,
  }) => {
    // The page's own in-progress fetch (user_id null, with its own limit; the
    // user menu makes a separate limit-1 call) resolves after the switch below.
    await test.step("hold your own in-progress fetch", async () => {
      await statsPage.holdOwnInProgress();
    });

    await test.step("open the stats page", async () => {
      await statsPage.gotoUnsettled();
      await expect(statsPage.readerPicker.trigger).toHaveAttribute(
        "aria-label",
        "Stats for You",
      );
    });

    await test.step("switch to the target", async () => {
      await statsPage.readerPicker.pick(householdTarget.id);
      await expect(statsPage.heroWho).toHaveText(
        `${householdTarget.username}'s stats`,
      );
      await expect(statsPage.inProgress).toContainText(TARGET_BOOK_TITLE);
    });

    await test.step("let the held fetch land", async () => {
      await statsPage.releaseOwnInProgress();
    });

    await test.step("check the target's card survived the stale answer", async () => {
      await expect(statsPage.inProgress).toContainText(TARGET_BOOK_TITLE);
    });

    await test.step("return to your own stats", async () => {
      await statsPage.readerPicker.pick("you");
      await statsPage.assertDisplayed();
    });
  });

  test("show the hero without a picker when the reader list fails", async ({
    statsPage,
  }) => {
    await test.step("fail the reader list", async () => {
      await statsPage.forceServerError(stats.householdReaders());
    });

    await test.step("open the stats page", async () => {
      await statsPage.goto();
    });

    await test.step("check the hero shows without a picker", async () => {
      await expect(statsPage.hero).toBeVisible();
      await expect(statsPage.readerPicker.root).toHaveCount(0);
    });
  });

  test("drop the target from the picker and refuse a direct link once sharing is off", async ({
    statsPage,
    householdTarget,
    secondReaderSettingsPage,
    secondReaderExpectMutation,
  }) => {
    await test.step("open the target's account settings", async () => {
      await secondReaderSettingsPage.goto("account");
      await expect(
        secondReaderSettingsPage.account.shareStatsSwitch,
      ).toBeChecked();
    });

    await test.step("turn the target's sharing off", async () => {
      await secondReaderExpectMutation(account.shareStats(false), () =>
        secondReaderSettingsPage.account.toggleShareStats(),
      );
    });

    // The options sit in the DOM even while the menu is closed.
    await test.step("check the picker drops the target", async () => {
      await statsPage.goto();
      await expect(
        statsPage.readerPicker.option(householdTarget.id),
      ).toHaveCount(0);
    });

    await test.step("check a direct link is refused", async () => {
      await statsPage.goto(householdTarget.id);
      await expect(statsPage.failureMessage).toHaveText(NOT_SHARING);
      await statsPage.backToYourStats();
      await statsPage.assertDisplayed();
    });

    // An id naming no reader at all gets the same refusal, not a crash.
    await test.step("check an unknown reader is refused the same way", async () => {
      await statsPage.goto(2147483647);
      await expect(statsPage.failureMessage).toHaveText(NOT_SHARING);
    });
  });
});
