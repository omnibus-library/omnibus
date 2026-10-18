// The load-bearing contract is the windowed / standing split: the pills govern
// everything under "In this window" and nothing in the hero or "Outside the
// window", and several tests exist only to hold that line.

import { stats } from "../contracts/stats";
import { buildSession, buildSummary, LIBRARY_COMPOSITION } from "../data/stats";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Unusual so a future fixture can't collide with it and change the slice count.
const DONUT_GENRE = "Stats Spec Gothic";

// Late 2023: inside Lifetime, outside the week, month and year windows.
const OLD_SESSION_AT = 1_700_000_000;

// A report with no capture offset is excluded from the time-pattern strips.
const TIME_PATTERN_OFFSET = -420;

test.describe("stats page", () => {
  // The seed writes shared server state; under fullyParallel it would re-run
  // per worker and the concurrent writes would 500 on SQLite's write lock.
  test.describe.configure({ mode: "serial" });

  // Seeded before the first /stats visit, so the server's 60s stats cache never
  // captures an empty summary; sessions need an indexed book, so library first.
  test.beforeAll(
    "seed the library and its reading history",
    async ({
      request,
      overridesRequests,
      statsRequests,
      bookRatingRequests,
      journalsRequests,
    }) => {
      await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
      const uuid = await fetchBookUuidByTitle(request, FIXTURE_BOOKS[0]!.title);

      // The genre donut counts books that have a genre, and nothing scans one.
      // Dracula is the designated feeder; only its genres key is written, so
      // the "Vampires" tag that search.spec reads stays untouched.
      const genredUuid = await fetchBookUuidByTitle(request, "Dracula");
      const genred = await overridesRequests.postOverrides(genredUuid, {
        genres: [DONUT_GENRE],
      });
      await expect(genred, "seed the donut genre").toBeOK();

      const now = Math.floor(Date.now() / 1000);
      const sitting = (
        bookUuid: string,
        startedAt: number,
        seconds: number,
        format: "epub" | "audio",
      ) =>
        buildSession(bookUuid, {
          startedAt,
          seconds,
          format,
          utcOffsetMinutes: TIME_PATTERN_OFFSET,
        });
      const sessions = await statsRequests.postSessions([
        sitting(uuid, now - 60, 600, "epub"),
        sitting(uuid, OLD_SESSION_AT, 900, "epub"),
        sitting(uuid, now - 120, 900, "audio"),
        sitting(genredUuid, now - 300, 300, "epub"),
      ]);
      await expect(sessions, "seed the sessions").toBeOK();
      const { recorded } = await sessions.json();
      expect(recorded, "the session seeds were skipped").toBe(4);

      // Feeds the headline tiles: a star rating and a finished (100%) journal.
      const rating = await bookRatingRequests.postRating(uuid, 4.5);
      await expect(rating, "seed a rating").toBeOK();
      const journal = await journalsRequests.postJournal(
        uuid,
        "Finished it — stats spec seed.",
        "published",
        100,
      );
      await expect(journal, "seed a finished journal").toBeOK();
    },
  );

  test("show the stats page layout", async ({ libraryPage, statsPage }) => {
    await test.step("open the stats page from the nav", async () => {
      await libraryPage.goto();
      await libraryPage.topNav.openStats();
      await statsPage.assertDisplayed();
      await statsPage.waitForSettled();
    });

    await test.step("check the nav and the hero", async () => {
      await statsPage.topNav.assertDisplayed();
      // The hero leads with the run the reader is on, above the switcher.
      await expect(statsPage.hero).toBeVisible();
      await expect(statsPage.currentStreak).toContainText(/\d/);
    });

    await test.step("check the scope switch and the period pills", async () => {
      await expect(statsPage.scopeSwitch).toBeVisible();
      await expect(statsPage.userScope).toBeVisible();
      for (const range of ["week", "month", "year", "all_time"] as const) {
        await expect(statsPage.periodPill(range)).toBeVisible();
      }
      await statsPage.assertPeriodSelected("month");
      await expect(statsPage.windowHead).toContainText("In this window");
      await expect(statsPage.windowLabel).toContainText(/month to date$/);
    });

    await test.step("check the windowed band and the reading clock", async () => {
      await expect(statsPage.periodSection).toBeVisible();
      await expect(statsPage.readingClock).toBeVisible();
      // The dial is the live end of the local-time path; every other test
      // stubs /api/rpc/stats, so a serde rename or dropped bind would leave
      // the suite green with this card stuck in its empty state.
      await expect(statsPage.clockEmpty).toHaveCount(0);
      await expect(statsPage.clockDial).toBeVisible();
      await expect(statsPage.clockWeekdays).toBeVisible();
    });

    await test.step("check the standing band", async () => {
      await expect(statsPage.outsideWindowLabel).toBeVisible();
      await expect(statsPage.standingSection).toBeVisible();
    });
  });

  test("show the headline tiles", async ({ statsPage }) => {
    await test.step("open the stats page", async () => {
      await statsPage.goto();
    });

    // Shapes, not numbers: other specs add sessions, ratings and journals for
    // the shared user, and db::stats owns the arithmetic.
    await test.step("check the four tiles", async () => {
      await expect(statsPage.tile("finished")).toContainText(/\d/);
      await expect(statsPage.tile("finished")).toContainText("Finished");
      await expect(statsPage.tile("avg-rating")).toContainText(/\d\.\d\s*★/);
      // Pages read counts pages turned in the window (#2139), and this spec
      // makes no position writes, which would join the landing's Continue fan.
      await expect(statsPage.tile("pages")).toContainText("Pages read");
      await expect(statsPage.tile("pages")).toContainText(/\d|—/);
      await expect(statsPage.tile("listening")).toContainText(/\d+\s*(m|h)/);
    });
  });

  test.describe("drill-ins", () => {
    test("open the pages read drill-in", async ({ statsPage }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("open the drill-in", async () => {
        await statsPage.openDrillIn("pages");
        await expect(statsPage.drillIn.root).toBeVisible();
        await expect(statsPage.drillIn.root).toContainText("Pages read");
      });

      // Page progress is differenced from stored positions and none exist
      // before the ledger began, so the tile changes meaning at a date.
      await test.step("check it explains its coverage and cutover", async () => {
        await expect(statsPage.drillIn.pagesNote).toBeVisible();
        await expect(statsPage.drillIn.pagesCutover).toContainText(
          /Page tracking began \d{4}-\d{2}-\d{2}/,
        );
      });

      await test.step("close the drill-in", async () => {
        await statsPage.drillIn.close();
        await expect(statsPage.drillIn.root).toHaveCount(0);
      });
    });

    test("open the avg rating drill-in", async ({ statsPage }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("open the drill-in", async () => {
        await statsPage.openDrillIn("avg-rating");
        await expect(statsPage.drillIn.root).toBeVisible();
        await expect(statsPage.drillIn.root).toContainText("Avg rating");
      });

      // Other specs write ratings on the shared fixture, so which of the
      // histogram and its empty state shows isn't ours to pin.
      await test.step("check it shows a delta, a trend and a histogram", async () => {
        await expect(statsPage.drillIn.delta).toBeVisible();
        await expect(statsPage.drillIn.trend).toBeVisible();
        await expect(statsPage.drillIn.histogramOrEmpty).toBeVisible();
      });
    });

    // The ratings are stubbed so the buckets are pinned; live ones would race
    // the specs that write ratings.
    test("show the avg rating buckets on a star axis", async ({
      statsPage,
    }) => {
      await test.step("stub a month of ratings", async () => {
        const histogram = Array.from({ length: 10 }, (_, i) => ({
          half_stars: i + 1,
          books: i === 6 ? 2 : i === 9 ? 3 : 0,
        }));
        // Oct 2025 through Sep 2026, rated in three months only.
        const ratingMonthly = Array.from({ length: 12 }, (_, i) => {
          const [year, month] = i < 3 ? [2025, 10 + i] : [2026, i - 2];
          const value = i === 4 ? 3.5 : i === 5 ? 4.25 : i === 11 ? 5 : 0;
          return { label: `${year}-${String(month).padStart(2, "0")}`, value };
        });
        await statsPage.stubSummary(
          buildSummary({
            avg_stars: 4.4,
            current_streak_days: 1,
            rating_histogram: histogram,
            rating_monthly: ratingMonthly,
          }),
        );
      });

      await test.step("open the avg rating drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("avg-rating");
      });

      // Empty buckets keep their place, or the shape lies, and the labels are
      // stars rather than the stored 1..=10 half-star scale.
      await test.step("check the histogram has ten star-labelled columns", async () => {
        await expect(statsPage.drillIn.histogram).toBeVisible();
        await expect
          .poll(() => statsPage.drillIn.histogramBarLabels.allInnerTexts())
          .toEqual([
            "0.5",
            "1",
            "1.5",
            "2",
            "2.5",
            "3",
            "3.5",
            "4",
            "4.5",
            "5",
          ]);
        await expect(
          statsPage.drillIn.histogramBar("5 ★ · 3 books"),
        ).toBeVisible();
        // Every rated bucket prints its count; the eight empty ones are slots.
        await expect(statsPage.drillIn.histogramBarValues).toHaveText([
          "2",
          "3",
        ]);
        await expect(statsPage.drillIn.histogramEmptyBars).toHaveCount(8);
        await expect(statsPage.drillIn.root).toContainText(
          "Books at each rating",
        );
        await expect(statsPage.drillIn.histogramCaption).toHaveText(
          "Rated this month",
        );
      });

      // The trend covers the trailing year, not the window the delta and
      // histogram follow.
      await test.step("check the trend names its period", async () => {
        await expect(statsPage.drillIn.root).toContainText(
          "Average rating by month",
        );
        await expect(statsPage.drillIn.trendCaption).toHaveText(
          "Oct 2025 – Sep 2026 · the last 12 months, whatever period is selected",
        );
        // Twelve distinct month names: June and July no longer both read "J".
        await expect(statsPage.drillIn.trendBarLabels).toHaveText([
          "Oct",
          "Nov",
          "Dec",
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
        ]);
        await expect(statsPage.drillIn.trendBarValues).toHaveText([
          "3.5",
          "4.3",
          "5.0",
        ]);
        await expect(statsPage.drillIn.trendEmptyBars).toHaveCount(9);
      });
    });

    // The rate comes from finished books and recorded time on the shared
    // fixture, which other specs write, so both answers are stubbed.
    test("show the pages reading rate", async ({ statsPage }) => {
      await test.step("stub a reading rate", async () => {
        await statsPage.stubSummary(
          buildSummary({ pages_read: 412, pages_per_hour: 32.6 }),
        );
      });

      await test.step("open the pages drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("pages");
      });

      // Whole pages above ten an hour (a decimal would dress an estimate as a
      // measurement), labelled an estimate like the tile it expands.
      await test.step("check the rate is a whole estimate", async () => {
        await expect(statsPage.drillIn.pagesRate).toBeVisible();
        await expect(statsPage.drillIn.pagesRate).toContainText("33");
        await expect(statsPage.drillIn.pagesRate).toContainText(
          "est. pages an hour",
        );
      });
    });

    test("explain a missing pages reading rate", async ({ statsPage }) => {
      await test.step("stub finished books with no recorded time", async () => {
        await statsPage.stubSummary(
          buildSummary({ pages_read: 412, pages_per_hour: null }),
        );
      });

      await test.step("open the pages drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("pages");
      });

      // No rate is a "can't tell", never a zero, and the copy names both
      // halves because either a missing length or missing time produces it.
      await test.step("check it says why there is no rate", async () => {
        await expect(statsPage.drillIn.pagesRate).toContainText(
          "both a measurable length and recorded reading time",
        );
      });
    });

    test("list the books finished in the window", async ({ statsPage }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("open the finished drill-in", async () => {
        await statsPage.openDrillIn("finished");
        await expect(statsPage.drillIn.finishedList).toBeVisible();
        await expect(statsPage.drillIn.finishedList).toContainText(
          FIXTURE_BOOKS[0]!.title,
        );
      });
    });

    // The bars depend on what the shared user has finished in the window.
    test("show the length distribution of finished books", async ({
      statsPage,
    }) => {
      await test.step("stub finished books of four lengths", async () => {
        await statsPage.stubSummary(
          buildSummary({
            current_streak_days: 1,
            books_finished: 6,
            length_buckets: [
              { label: "Under 300", books: 3 },
              { label: "300–499", books: 2 },
              { label: "500+", books: 0 },
              { label: "Unknown", books: 1 },
            ],
          }),
        );
      });

      // How long the finished books were is a fact about the Finished tile,
      // not a peer of it, so it lives inside that tile's drill-in.
      await test.step("open the finished drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("finished");
        await expect(statsPage.drillIn.lengthSplit).toBeVisible();
      });

      // The empty bucket and the unmeasurable one are rendered too.
      await test.step("check every bucket shows, with counts", async () => {
        for (const label of ["Under 300", "300–499", "500+", "Unknown"]) {
          await expect(statsPage.drillIn.lengthSplit).toContainText(label);
        }
        // Counts, not shares: "3 books" needs no denominator to be read.
        await expect(statsPage.drillIn.firstLengthRow).toContainText("3");
      });
    });

    // Regression for #2454: the Finished tile read "−2" while its sheet read
    // "▼100%", and a "flat" tile opened onto "Not enough data yet to compare".
    test("match each tile's delta to its drill-in", async ({ statsPage }) => {
      await test.step("stub a week against the week before", async () => {
        await statsPage.stubSummary(
          buildSummary({
            range: "week",
            books_finished: 0,
            previous: {
              books_finished: 2,
              avg_stars: null,
              listening_seconds: 0,
              pages_read: 0,
            },
          }),
        );
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      for (const [tile, label] of [
        ["finished", "\u{2212}2"],
        ["listening", "flat"],
      ] as const) {
        await test.step(`compare the ${tile} tile with its drill-in`, async () => {
          await expect(statsPage.tileDelta(tile)).toHaveText(label);
          await statsPage.openDrillIn(tile);
          await expect(statsPage.drillIn.delta).toContainText(label);
          await expect(statsPage.drillIn.delta).toContainText("vs last week");
          await statsPage.drillIn.close();
          await expect(statsPage.drillIn.root).toHaveCount(0);
        });
      }
    });

    test("close a drill-in with its close button", async ({ statsPage }) => {
      await test.step("open a drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("avg-rating");
        await expect(statsPage.drillIn.root).toBeVisible();
      });

      await test.step("close it", async () => {
        await statsPage.drillIn.close();
        await expect(statsPage.drillIn.root).toHaveCount(0);
      });

      await test.step("check the selected period is untouched", async () => {
        await statsPage.assertPeriodSelected("month");
      });
    });

    test("close a drill-in from its backdrop", async ({ statsPage }) => {
      await test.step("open a drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("finished");
        await expect(statsPage.drillIn.root).toBeVisible();
      });

      await test.step("click outside the sheet", async () => {
        await statsPage.drillIn.closeFromBackdrop();
        await expect(statsPage.drillIn.root).toHaveCount(0);
      });
    });

    // Regression for #2465: the sheet is a modal scrim over the page, and
    // Escape did nothing; the Close button was the only way out.
    test("close a drill-in with escape", async ({ statsPage }) => {
      await test.step("open a drill-in", async () => {
        await statsPage.goto();
        await statsPage.openDrillIn("finished");
        await expect(statsPage.drillIn.root).toBeVisible();
      });

      await test.step("press escape", async () => {
        await statsPage.drillIn.closeWithEscape();
        await expect(statsPage.drillIn.root).toHaveCount(0);
      });
    });
  });

  test.describe("window", () => {
    test("switch the window to a week", async ({
      statsPage,
      expectMutation,
    }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("select the week pill", async () => {
        await expectMutation(stats.summary("week"), () =>
          statsPage.selectPeriod("week"),
        );
        await statsPage.assertPeriodSelected("week");
      });

      // The window label says what "this window" currently means.
      await test.step("check the window follows the pill", async () => {
        await expect(statsPage.windowLabel).toContainText(
          /^Week of \d{1,2} \w{3} \d{4} · to date$/,
        );
        await expect(statsPage.periodPill("month")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      });
    });

    // Lifetime has no previous window, so every tile drops its comparison
    // rather than measuring against a zero nobody recorded.
    test("switch the window to lifetime", async ({
      statsPage,
      expectMutation,
    }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("select the lifetime pill", async () => {
        await expectMutation(stats.summary("all_time"), () =>
          statsPage.selectPeriod("all_time"),
        );
        await statsPage.assertPeriodSelected("all_time");
      });

      await test.step("check the tiles drop their comparison", async () => {
        await expect(statsPage.windowLabel).toContainText(
          "Everything you have tracked",
        );
        await expect(statsPage.tileDelta("finished")).toHaveCount(0);
      });
    });

    // The pills govern the windowed band and nothing else; a regression here
    // is the whole redesign undone.
    test("keep the hero and the standing band when the window changes", async ({
      statsPage,
      expectMutation,
    }) => {
      const before =
        await test.step("note the hero and the standing band", async () => {
          await statsPage.goto();
          await expect(statsPage.standingSection).toBeVisible();
          return {
            hero: await statsPage.hero.textContent(),
            standing: await statsPage.standingSection.textContent(),
          };
        });

      await test.step("select the year pill", async () => {
        await expectMutation(stats.summary("year"), () =>
          statsPage.selectPeriod("year"),
        );
        await statsPage.assertPeriodSelected("year");
        await expect(statsPage.windowLabel).toContainText("year to date");
      });

      await test.step("check the hero and the standing band are unchanged", async () => {
        await expect
          .poll(() => statsPage.standingSection.textContent())
          .toBe(before.standing);
        await expect.poll(() => statsPage.hero.textContent()).toBe(before.hero);
      });
    });
  });

  test.describe("activity", () => {
    test("show the heatmap and genre donut", async ({ statsPage }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("check the heatmap", async () => {
        await expect(statsPage.heatmap).toBeVisible();
        await expect(statsPage.daysRead).toContainText("days read");
        // The record stands here; the run the reader is on leads the hero, and
        // a second copy two bands apart is where two surfaces start to disagree.
        await expect(statsPage.heatmapLongestStreak).toContainText("best run");
        await expect(statsPage.heatmapCurrentStreak).toHaveCount(0);
        await expect(statsPage.heatmapActiveCells).not.toHaveCount(0);
      });

      // The centre counts the books the ring describes ("tagged"). This spec
      // also seeds activity on an ungenred book, so the untagged disclosure
      // always renders; it is matched by pattern because other specs add books.
      await test.step("check the genre donut", async () => {
        await expect(statsPage.genreDonut).toBeVisible();
        await expect(statsPage.genreDonut).toContainText(DONUT_GENRE);
        await expect(statsPage.genreDonut).toContainText("%");
        await expect(statsPage.genreDonut).toContainText("tagged");
        await expect(statsPage.donutUntagged).toHaveText(
          /^\+\d+ books? without a genre$/,
        );
      });

      // The split rides the donut's foot: the ring says what was read and the
      // bars say how, and two cards left a reader comparing them.
      await test.step("check the read and listened split", async () => {
        await expect(statsPage.formatSplit).toContainText("Read");
        await expect(statsPage.formatSplit).toContainText("Listened");
      });
    });

    test("show the books-per-month chart", async ({ statsPage }) => {
      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("check twelve bars with the current month highlighted", async () => {
        await expect(statsPage.monthlyChart).toBeVisible();
        await expect(statsPage.monthlyChart).toContainText("avg");
        await expect(statsPage.monthlyBars).toHaveCount(12);
        await expect(statsPage.currentMonthBar).toHaveClass(/current/);
      });
    });

    // The superlatives rank over finished books and sessions on the shared
    // fixture, which other specs write, so both answers are stubbed.
    test("show the superlatives", async ({ statsPage }) => {
      await test.step("stub two standouts", async () => {
        await statsPage.stubSummary(
          buildSummary({
            books_finished: 2,
            busiest_week_start: "2023-11-13",
            busiest_week_seconds: 14_400,
            top_authors: [{ name: "Ursula K. Le Guin", seconds: 3600 }],
            superlatives: {
              longest_book: {
                book_uuid: "u1",
                title: "Doorstopper",
                author: "A. Writer",
                value: 900,
              },
              fastest_read: {
                book_uuid: "u2",
                title: "Sprint",
                author: null,
                value: 3,
              },
            },
          }),
        );
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("check the card names each standout", async () => {
        await expect(statsPage.superlatives).toBeVisible();
        await expect(statsPage.superlatives).toContainText("Doorstopper");
        await expect(statsPage.superlatives).toContainText("900 pages");
        await expect(statsPage.superlatives).toContainText("in 3 days");
        // The busiest week and the most-read author come off fields the
        // payload has always carried and the web page never drew.
        await expect(statsPage.superlatives).toContainText(
          "Week of 13 Nov 2023",
        );
        await expect(statsPage.superlatives).toContainText("Ursula K. Le Guin");
        // Absent superlatives cost their row, not an em-dash.
        await expect(statsPage.superlatives).not.toContainText("Shortest book");
        await expect(statsPage.superlatives).not.toContainText(
          "Longest sitting",
        );
        // The fastest read is a lower bound, and says so.
        await expect(statsPage.superlativesNote).toContainText(
          "tracked session",
        );
      });
    });

    test("omit the superlatives when nothing stands out", async ({
      statsPage,
    }) => {
      await test.step("stub a window with no standouts", async () => {
        await statsPage.stubSummary(
          buildSummary({
            books_finished: 2,
            busiest_week_start: null,
            busiest_week_seconds: 0,
          }),
        );
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      // Wait on a period-owned element, not the section: until the period
      // fetch resolves a bare placeholder renders with no card, so asserting
      // the absence first would pass on the loading state.
      await test.step("check the card is absent, not an empty heading", async () => {
        await expect(statsPage.tile("finished")).toBeVisible();
        await expect(statsPage.superlatives).toHaveCount(0);
      });
    });

    // The buckets are stubbed: any other spec posting a session moves the
    // ticks on the shared server and user.
    test("show the reading clock and name the peak", async ({ statsPage }) => {
      await test.step("stub a window read at 9am and mostly at 9pm", async () => {
        const hours = Array.from({ length: 24 }, (_, hour) => ({
          hour,
          seconds: hour === 21 ? 15120 : hour === 9 ? 3600 : 0,
        }));
        const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
          (label, weekday) => ({
            weekday,
            label,
            seconds: label === "Sun" ? 15120 : 0,
          }),
        );
        await statsPage.stubSummary(
          buildSummary({
            reading_seconds: 18720,
            sessions: 2,
            active_days: 2,
            current_streak_days: 1,
            busiest_week_seconds: 18720,
            hour_of_day: hours,
            day_of_week: days,
            unzoned_seconds: 15120,
          }),
        );
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      // All 24 ticks render, quiet hours included: the shape of a day is the
      // information, so an omitted hour would misdescribe it.
      await test.step("check the dial draws every hour and names the peak", async () => {
        await expect(statsPage.clockDial).toBeVisible();
        await expect(statsPage.clockTicks).toHaveCount(24);
        await expect(statsPage.clockPeak).toHaveText("9pm");
        // 9pm is the last hour of the evening band (the late band starts at
        // 10), so the sentence names the part of the day, not just a number.
        await expect(statsPage.clockLine).toContainText("Evenings are yours");
      });

      // Weekdays are the server's labels in the server's order: the web never
      // decides where the week starts.
      await test.step("check the weekday strip", async () => {
        await expect
          .poll(() => statsPage.weekdayLabels.allInnerTexts())
          .toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
        // A day with nothing on it is an absence, never a measured zero.
        await expect
          .poll(() => statsPage.weekdayReadouts.allInnerTexts())
          .toEqual(["—", "—", "—", "—", "—", "—", "4h 12m"]);
      });

      // Activity the server couldn't place on a local clock is disclosed, not
      // folded into a UTC hour.
      await test.step("check the unplaced activity is disclosed", async () => {
        await expect(statsPage.clockUnzoned).toContainText("4h 12m");
      });
    });

    // A window whose sessions all predate capture-time timezones: the strips
    // are zero-filled to a fixed width, so drawing them would show 24 empty
    // columns that look like a measured day.
    test("say so instead of drawing an empty reading clock", async ({
      statsPage,
    }) => {
      await test.step("stub a window with only unplaced activity", async () => {
        await statsPage.stubSummary(
          buildSummary({
            reading_seconds: 18720,
            sessions: 2,
            active_days: 2,
            current_streak_days: 1,
            busiest_week_seconds: 18720,
            hour_of_day: Array.from({ length: 24 }, (_, hour) => ({
              hour,
              seconds: 0,
            })),
            // Zero-filled to 7 like the server always sends it: the empty
            // state keys on the hour strip, so the mock must be a real shape.
            day_of_week: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
              (label, weekday) => ({ weekday, label, seconds: 0 }),
            ),
            unzoned_seconds: 18720,
          }),
        );
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      // No peak hour is an absence, never midnight: the first maximum of a row
      // of zeros is index 0, and reporting it would invent a habit.
      await test.step("check the card says so rather than drawing a dial", async () => {
        await expect(statsPage.clockEmpty).toBeVisible();
        await expect(statsPage.clockDial).toHaveCount(0);
        await expect(statsPage.clockPeak).toHaveCount(0);
        await expect(statsPage.clockUnzoned).toContainText("5h 12m");
      });
    });

    // Self-registration is disabled after the first account and the shared
    // user has seeded sessions, so an all-zero summary stands in for a new one.
    test("show the friendly empty state for a reader with no activity", async ({
      statsPage,
    }) => {
      await test.step("stub a summary with no activity", async () => {
        await statsPage.stubSummary(
          buildSummary({
            reading_seconds: 0,
            sessions: 0,
            active_days: 0,
            longest_streak_days: 0,
            busiest_week_seconds: 0,
            books_finished: 0,
          }),
        );
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("check the empty state shows", async () => {
        await expect(statsPage.emptyState).toBeVisible();
        await expect(statsPage.noActivityMessage).toBeVisible();
        await expect(statsPage.periodSection).toHaveCount(0);
        await expect(statsPage.standingSection).toHaveCount(0);
      });

      // The goals are set from the hero, and a reader with no activity is
      // exactly who wants to set one.
      await test.step("check the hero stays", async () => {
        await expect(statsPage.hero).toBeVisible();
      });
    });
  });

  // The real size and mix depend on the backfill and the fixture library,
  // which no spec can pin, so the library figures are stubbed.
  test.describe("library scope", () => {
    test("show the library size with its coverage", async ({ statsPage }) => {
      await test.step("stub a library measured for words and pages", async () => {
        await statsPage.stubLibrarySize({
          books: 1510,
          words: { total: 412_000_000, books: 1204 },
          pages: { total: 1_600_000, books: 1204 },
          // Nothing probed yet: the figure is absent, never a zero.
          listening_seconds: { total: 0, books: 0 },
        });
      });

      await test.step("open the library scope", async () => {
        await statsPage.goto();
        await statsPage.openLibraryScope();
      });

      await test.step("check the card states each total with its coverage", async () => {
        await expect(statsPage.librarySize).toBeVisible();
        // The scope reads as a sentence before it reads as figures.
        await expect(statsPage.librarySize).toContainText("1,510 books.");
        await expect(statsPage.librarySize).toContainText("412 million words");
        await expect(statsPage.librarySize).toContainText("412M");
        await expect(statsPage.librarySize).toContainText("1.6M");
        // Never a bare total: the denominator is what makes it a fact.
        await expect(statsPage.librarySize).toContainText(
          "across 1,204 of 1,510 books",
        );
        await expect(statsPage.libraryFigures).toHaveCount(2);
      });

      // These are the shelf's figures, not the reader's, and the pills are
      // absent here rather than present and inert.
      await test.step("check the scope switch drops the period pills", async () => {
        await expect(statsPage.scopeSwitch).toContainText("not period-scoped");
        await expect(statsPage.periodPill("week")).toHaveCount(0);
      });
    });

    test("omit the size card for a library measured for nothing", async ({
      statsPage,
    }) => {
      await test.step("stub a library with no measurements", async () => {
        await statsPage.stubLibrarySize({ books: 40 });
      });

      await test.step("open the library scope", async () => {
        await statsPage.goto();
        await statsPage.openLibraryScope();
      });

      // Three zeroes would read as a claim about the collection rather than
      // about the backfill.
      await test.step("check no size card shows", async () => {
        await expect(statsPage.librarySize).toHaveCount(0);
      });
    });

    test("show the library composition with its coverage", async ({
      statsPage,
    }) => {
      await test.step("stub a mixed library", async () => {
        await statsPage.stubLibraryComposition(LIBRARY_COMPOSITION);
      });

      await test.step("open the library scope", async () => {
        await statsPage.goto();
        await statsPage.openLibraryScope();
      });

      await test.step("check each panel titles itself", async () => {
        await expect(statsPage.libraryComposition).toBeVisible();
        // The scope switch already says these are the shelf's figures, so a
        // section heading would be a third statement of the same thing.
        for (const title of ["Formats", "Languages", "Publishers", "Genres"]) {
          await expect(statsPage.libraryComposition).toContainText(title);
        }
        await expect(statsPage.compositionFormats).toContainText("EPUB");
        await expect(statsPage.compositionDecades).toContainText("1990s");
      });

      await test.step("check the notes on coverage and exclusions", async () => {
        // Genres are hand-assigned, so the slices describe 58 books, not 1,510.
        await expect(statsPage.compositionGenres).toContainText(
          "hand-assigned — across 58 of 1,510 books",
        );
        // Dual-format books are counted in both bars, and said so.
        await expect(statsPage.compositionFormats).toContainText(
          "+70 books held in more than one format",
        );
        // Ghosted rows are named rather than left to make the bars not add up.
        await expect(statsPage.compositionGhosted).toContainText(
          "4 books excluded",
        );
      });
    });

    test("show an empty state for a composition dimension with no data", async ({
      statsPage,
    }) => {
      await test.step("stub a library with no publisher metadata", async () => {
        await statsPage.stubLibraryComposition(LIBRARY_COMPOSITION);
      });

      await test.step("open the library scope", async () => {
        await statsPage.goto();
        await statsPage.openLibraryScope();
      });

      // An axis with no bars on it is the failure this replaces.
      await test.step("check publishers say so instead of drawing an empty chart", async () => {
        await expect(statsPage.compositionPublishers).toContainText(
          "No publisher metadata yet.",
        );
        await expect(statsPage.compositionPublisherBars).toHaveCount(0);
      });
    });

    test("omit the composition card for a library with nothing to describe", async ({
      statsPage,
    }) => {
      await test.step("stub an empty library", async () => {
        await statsPage.stubLibraryComposition({ books: 0 });
      });

      // The card is also absent when the fetch never happened, so waiting on
      // the stubbed response fails the test if the route moves.
      await test.step("open the library scope once the fetch is answered", async () => {
        const answered = statsPage.waitForLibraryComposition();
        await statsPage.goto();
        await answered;
        await statsPage.openLibraryScope();
      });

      await test.step("check no composition card shows", async () => {
        await expect(statsPage.libraryComposition).toHaveCount(0);
      });
    });
  });

  test.describe("goals", () => {
    // Goals are account configuration, and all three are set together in
    // Settings → Account. This page reports them but must not grow an editor
    // back: that split is the whole reason there is one Edit button.
    test("report the goals without an editor", async ({
      statsPage,
      presetGoals,
    }) => {
      await test.step("set an annual and a daily pages goal", async () => {
        await presetGoals({ books: 24, pages: 30 });
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      await test.step("check the goals are reported", async () => {
        await expect(statsPage.goalFigure).toContainText(/of 24 books/);
        await expect(statsPage.goalProgress).toHaveAttribute(
          "aria-valuemax",
          "24",
        );
        await expect(statsPage.dailyPagesFigure).toContainText(/of 30 pages/);
        // The untargeted kind still reports today's figure, a readout rather
        // than a goal, and carries its own timeframe because the card header
        // has moved to "Every day" for the targeted row's sake.
        await expect(statsPage.dailyMinutesToday).toBeVisible();
        await expect(statsPage.dailyGoals).toContainText("Minutes today");
      });

      await test.step("check no editor shows", async () => {
        await expect(statsPage.goalEditors).toHaveCount(0);
      });
    });

    test("report the real figures when no goals are set", async ({
      statsPage,
      presetGoals,
    }) => {
      await test.step("clear every goal", async () => {
        await presetGoals();
      });

      await test.step("open the stats page", async () => {
        await statsPage.goto();
      });

      // No target means no ring and no bar, since both are claims a target
      // makes, but the figures behind them still show where the reader stands.
      await test.step("check the figures show without a ring or bar", async () => {
        await expect(statsPage.goalProgress).toHaveCount(0);
        await expect(statsPage.goalYearToDate).toBeVisible();
        await expect(statsPage.dailyPagesToday).toBeVisible();
        await expect(statsPage.dailyMinutesToday).toBeVisible();
        await expect(statsPage.dailyPagesProgress).toHaveCount(0);
      });

      // The annual kicker carries the year and the daily card's header carries
      // "Today", so each label says its timeframe exactly once.
      await test.step("check each label names its timeframe once", async () => {
        await expect(statsPage.hero).toContainText(/\d{4} so far/);
        await expect(statsPage.hero).not.toContainText("This year");
        await expect(statsPage.dailyGoals).not.toContainText("Pages a day");
      });
    });

    test("open the goal editor from the hero", async ({
      statsPage,
      settingsPage,
      presetGoals,
    }) => {
      await test.step("clear every goal and open the stats page", async () => {
        await presetGoals();
        await statsPage.goto();
      });

      await test.step("follow the link to the one place goals are set", async () => {
        await expect(statsPage.dailySetLink).toBeVisible();
        await statsPage.openGoalEditor();
        await settingsPage.assertDisplayedFor("account");
        await expect(settingsPage.account.goalsCard).toBeVisible();
      });
    });
  });
});
