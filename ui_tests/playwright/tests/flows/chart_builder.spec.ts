import { chartBuilder } from "../contracts/chartBuilder";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// Every test is about the picker's contract, never plotted values: reading
// history is shared state the reader and read-status specs write. Tests that
// need marks stub the chart read, so what the page does with a well-formed
// result is covered here and what the server computes is db::stats::builder's.
test.describe("chart builder", () => {
  // Nothing in the UI links to the builder yet, so the specs reach it by URL, a
  // departure from rule 04's navigation clause that lapses when /stats links it.
  test("show the chart builder layout", async ({ chartBuilderPage }) => {
    await test.step("open the chart builder", async () => {
      await chartBuilderPage.goto();
    });

    await test.step("check the page and its nav", async () => {
      await chartBuilderPage.assertDisplayed();
      await chartBuilderPage.topNav.assertDisplayed();
      await expect(chartBuilderPage.heading).toBeVisible();
    });

    await test.step("check the picker and an empty plot", async () => {
      await expect(chartBuilderPage.controls).toBeVisible();
      await expect(chartBuilderPage.measures).toBeVisible();
      // Opens empty, so the prompt stands where the chart will be.
      await expect(chartBuilderPage.prompt).toBeVisible();
      await expect(chartBuilderPage.canvas).toHaveCount(0);
      for (const select of [
        chartBuilderPage.groupBySelect,
        chartBuilderPage.periodSelect,
        chartBuilderPage.splitSelect,
      ]) {
        await expect(select).toBeVisible();
      }
    });
  });

  test.describe("measures", () => {
    // No opinion is pre-loaded and no unit has claimed a scale, so the whole
    // vocabulary is available: the compatibility rule is visible rather than
    // discovered by being blocked.
    test("show every measure available before one is plotted", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder", async () => {
        await chartBuilderPage.goto();
      });

      await test.step("check no measure is ticked or greyed out", async () => {
        for (const name of [
          "Books finished",
          "Avg rating",
          "Reading minutes",
        ]) {
          await expect(chartBuilderPage.measure(name)).not.toBeChecked();
          await expect(chartBuilderPage.measure(name)).toBeEnabled();
        }
        await expect(chartBuilderPage.prompt).toBeVisible();
      });
    });

    test("plot a measure by ticking it", async ({ chartBuilderPage }) => {
      await test.step("open the chart builder", async () => {
        await chartBuilderPage.goto();
      });

      await test.step("tick a measure", async () => {
        await chartBuilderPage.tickMeasure("Books finished");
      });

      await test.step("check the prompt gives way to a plot", async () => {
        await expect(chartBuilderPage.prompt).toHaveCount(0);
        await expect(chartBuilderPage.canvas).toBeVisible();
      });
    });

    // Clearing the chart is a state a reader is allowed to reach.
    test("clear the last measure back to an empty chart", async ({
      chartBuilderPage,
    }) => {
      await test.step("plot a measure", async () => {
        await chartBuilderPage.goto();
        await chartBuilderPage.tickMeasure("Books finished");
        await expect(chartBuilderPage.canvas).toBeVisible();
      });

      await test.step("untick it", async () => {
        await chartBuilderPage.untickMeasure("Books finished");
      });

      await test.step("check the prompt returns", async () => {
        await expect(chartBuilderPage.prompt).toBeVisible();
        await expect(chartBuilderPage.canvas).toHaveCount(0);
      });
    });

    test("offer every measure with the unit that decides its compatibility", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder", async () => {
        await chartBuilderPage.goto();
      });

      await test.step("check every measure and its unit show", async () => {
        for (const name of [
          "Books finished",
          "Avg book length",
          "Avg rating",
          "Reading minutes",
          "Listening minutes",
          "Sittings",
          "Avg sitting length",
          "Pages read",
        ]) {
          await expect(chartBuilderPage.measure(name)).toBeVisible();
        }
        await expect(chartBuilderPage.measures).toContainText(
          "books · per book finished",
        );
        await expect(chartBuilderPage.measures).toContainText(
          "minutes · per sitting",
        );
      });
    });

    test("narrow the list only once both scales are claimed", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
      });

      // Books and pages hold both scales: a third unit is blocked, but a
      // second pages measure still joins the scale pages already own.
      await test.step("check a third unit is blocked", async () => {
        await expect(chartBuilderPage.scalesHint).toContainText(
          "Both scales in use",
        );
        await expect(chartBuilderPage.measure("Avg rating")).toBeDisabled();
        await expect(
          chartBuilderPage.measure("Reading minutes"),
        ).toBeDisabled();
        await expect(chartBuilderPage.measure("Pages read")).toBeEnabled();
      });

      await test.step("free the pages scale", async () => {
        await chartBuilderPage.untickMeasure("Avg book length");
        await expect(chartBuilderPage.scalesHint).toContainText(
          "anything else can still join",
        );
        await expect(chartBuilderPage.measure("Avg rating")).toBeEnabled();
        await expect(chartBuilderPage.measure("Reading minutes")).toBeEnabled();
      });
    });

    // The bound is on scales, not on how many measures use them.
    test("plot more measures than there are scales", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
      });

      await test.step("add a third measure that shares a unit", async () => {
        await chartBuilderPage.tickMeasure("Pages read");
        await expect(chartBuilderPage.measure("Pages read")).toBeChecked();
      });

      await test.step("check the legend names all three", async () => {
        await expect(chartBuilderPage.legend).toContainText("Books finished");
        await expect(chartBuilderPage.legend).toContainText("Avg book length");
        await expect(chartBuilderPage.legend).toContainText("Pages read");
      });
    });

    test("offer a split only for a single per-book measure", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
      });

      // Two measures leave no single population for a split to describe.
      await test.step("check two measures disable the split", async () => {
        await expect(chartBuilderPage.splitSelect).toBeDisabled();
        await expect(chartBuilderPage.controls).toContainText(
          "one measure only",
        );
      });

      await test.step("keep one per-book measure", async () => {
        await chartBuilderPage.untickMeasure("Avg book length");
        await expect(chartBuilderPage.splitSelect).toBeEnabled();
      });

      // A sitting cannot carry a genre: one may cover several books and a book
      // several genres, so splitting it would double-count its minutes.
      await test.step("switch to a per-sitting measure", async () => {
        await chartBuilderPage.tickMeasure("Books finished");
        await chartBuilderPage.tickMeasure("Reading minutes");
        await chartBuilderPage.untickMeasure("Books finished");
        await expect(chartBuilderPage.splitSelect).toBeDisabled();
        await expect(chartBuilderPage.controls).toContainText(
          "only per-book measures split",
        );
      });
    });
  });

  test.describe("plot", () => {
    test("redraw when the selection changes", async ({ chartBuilderPage }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
      });

      // The canvas resolves to a chart or the empty state, depending on the
      // history the rest of the suite produced, but never hangs.
      await test.step("check the canvas settles", async () => {
        await expect
          .poll(() => chartBuilderPage.drawnState())
          .not.toBe("pending");
      });

      // Add before removing: the last remaining measure is held checked, so the
      // selection can never pass through empty.
      await test.step("swap both measures for pages read", async () => {
        await chartBuilderPage.tickMeasure("Pages read");
        await chartBuilderPage.untickMeasure("Books finished");
        await chartBuilderPage.untickMeasure("Avg book length");
        await expect
          .poll(() => chartBuilderPage.drawnState())
          .not.toBe("pending");
        await expect(chartBuilderPage.canvas).toBeVisible();
      });

      await test.step("check its bounded coverage is stated in the notes", async () => {
        await expect(chartBuilderPage.measure("Pages read")).toBeChecked();
        await chartBuilderPage.openNotes();
        await expect(chartBuilderPage.firstCaveat).toContainText(
          "progress ledger",
        );
      });
    });

    test("read every series at the hovered bucket", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
      });

      // Hover is client-only state, so the server-rendered first paint has to
      // match it (rule 07).
      await test.step("check no tooltip shows before a hover", async () => {
        await expect(chartBuilderPage.tooltip).toHaveCount(0);
      });

      // Both series at once, each with its own unit, since they may be on
      // different scales.
      await test.step("hover a bucket", async () => {
        await chartBuilderPage.hoverBucket(2);
        await expect(chartBuilderPage.tooltip).toBeVisible();
        await expect(chartBuilderPage.tooltip).toContainText("Books finished");
        await expect(chartBuilderPage.tooltip).toContainText("books");
        await expect(chartBuilderPage.tooltip).toContainText("Avg book length");
        await expect(chartBuilderPage.tooltip).toContainText("pages");
      });
    });

    test("stack a split count into one column per bucket", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot books finished by genre", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
        await chartBuilderPage.untickMeasure("Avg book length");
        await chartBuilderPage.splitBy("genre");
      });

      // The previous chart stays up until its replacement arrives, so a row
      // count can't tell the split has landed; only a split makes this label.
      await test.step("check the split has landed", async () => {
        await expect(chartBuilderPage.legend).toContainText("Books finished ·");
      });

      // Stacked bars share one lane, so every bar in a bucket has the same x.
      await test.step("check each bucket stacks into one column", async () => {
        const positions = await chartBuilderPage.barPositions();
        const buckets = await chartBuilderPage.xLabelCount();
        expect(positions.length).toBeGreaterThan(buckets);
        expect(new Set(positions).size).toBeLessThanOrEqual(buckets);
      });
    });

    test.describe("zoom", () => {
      test("zoom to a brushed range", async ({ chartBuilderPage }) => {
        await test.step("open the chart builder with a stubbed chart", async () => {
          await chartBuilderPage.stubChartSeries();
          await chartBuilderPage.goto();
        });

        const before =
          await test.step("plot a count against an average", async () => {
            await chartBuilderPage.plotCountAgainstAverage();
            const periods = await chartBuilderPage.bucketCount();
            expect(periods).toBeGreaterThan(3);
            // Nothing to reset before a zoom exists.
            await expect(chartBuilderPage.zoomBar).toHaveCount(0);
            return periods;
          });

        await test.step("brush across the middle periods", async () => {
          await chartBuilderPage.brush(1, before - 2);
        });

        await test.step("check the plot zooms", async () => {
          await expect(chartBuilderPage.zoomBar).toBeVisible();
          await expect(chartBuilderPage.zoomBar).toContainText(
            `of ${before} periods`,
          );
          await expect
            .poll(() => chartBuilderPage.bucketCount())
            .toBeLessThan(before);
        });
      });

      test("show all periods after zooming", async ({ chartBuilderPage }) => {
        await test.step("open the chart builder with a stubbed chart", async () => {
          await chartBuilderPage.stubChartSeries();
          await chartBuilderPage.goto();
        });

        const before =
          await test.step("plot a count against an average and zoom in", async () => {
            await chartBuilderPage.plotCountAgainstAverage();
            const periods = await chartBuilderPage.bucketCount();
            await chartBuilderPage.brush(1, periods - 2);
            await expect(chartBuilderPage.zoomBar).toBeVisible();
            return periods;
          });

        await test.step("show all", async () => {
          await chartBuilderPage.showAll();
        });

        await test.step("check every period returns", async () => {
          await expect(chartBuilderPage.zoomBar).toHaveCount(0);
          await expect.poll(() => chartBuilderPage.bucketCount()).toBe(before);
        });
      });

      test("drop a zoom the regrouped axis can no longer resolve", async ({
        chartBuilderPage,
      }) => {
        await test.step("open the chart builder with a stubbed chart", async () => {
          await chartBuilderPage.stubChartSeries();
          await chartBuilderPage.goto();
        });

        await test.step("plot a count against an average and zoom in", async () => {
          await chartBuilderPage.plotCountAgainstAverage();
          const periods = await chartBuilderPage.bucketCount();
          await chartBuilderPage.brush(1, periods - 2);
          await expect(chartBuilderPage.zoomBar).toBeVisible();
        });

        // Regrouping replaces every bucket key, so the zoom has nothing to
        // resolve against and drops itself rather than frame another stretch.
        await test.step("regroup by week", async () => {
          await chartBuilderPage.groupBy("week");
          await expect(chartBuilderPage.zoomBar).toHaveCount(0);
        });
      });
    });
  });

  test.describe("notes", () => {
    test("explain what the chart shows and why the list is narrowed", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
      });

      // Closed by default, so the notes never push the chart off screen.
      await test.step("check the notes start closed", async () => {
        await expect(chartBuilderPage.notes).toBeVisible();
        await expect(chartBuilderPage.notesScales).toBeHidden();
      });

      await test.step("open the notes", async () => {
        await chartBuilderPage.openNotes();
      });

      // Each measure says what it counts, at which grain, in which unit.
      await test.step("check they describe each measure", async () => {
        await expect(chartBuilderPage.notes).toContainText(
          "Books you marked finished",
        );
        await expect(chartBuilderPage.notes).toContainText(
          "Measured per book finished, in books.",
        );
      });

      // Two units on screen, so the notes warn that a crossing means nothing
      // and say which units are holding the scales.
      await test.step("check they warn about two scales", async () => {
        await expect(chartBuilderPage.notesScales).toContainText(
          "means nothing",
        );
        await expect(chartBuilderPage.notesAvailability).toContainText(
          "books and pages",
        );
      });
    });

    test("rewrite the notes when the selection changes", async ({
      chartBuilderPage,
    }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average and open the notes", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
        await chartBuilderPage.openNotes();
      });

      // One unit leaves a free scale and nothing to misread across axes.
      await test.step("keep one unit", async () => {
        await chartBuilderPage.untickMeasure("Avg book length");
        await expect(chartBuilderPage.notesAvailability).toContainText(
          "still free",
        );
        await expect(chartBuilderPage.notesScales).not.toContainText(
          "means nothing",
        );
      });

      await test.step("switch to a measure with a bounded window", async () => {
        await chartBuilderPage.tickMeasure("Pages read");
        await chartBuilderPage.untickMeasure("Books finished");
        await expect(chartBuilderPage.firstCaveat).toContainText(
          "progress ledger",
        );
      });
    });

    test("say what zooming can and cannot do", async ({ chartBuilderPage }) => {
      await test.step("open the chart builder with a stubbed chart", async () => {
        await chartBuilderPage.stubChartSeries();
        await chartBuilderPage.goto();
      });

      await test.step("plot a count against an average and open the notes", async () => {
        await chartBuilderPage.plotCountAgainstAverage();
        await chartBuilderPage.openNotes();
      });

      // The limit of a client-side zoom is stated rather than left to be found.
      await test.step("check the zoom note", async () => {
        await expect(chartBuilderPage.notesZoom).toContainText(
          "Drag across the chart",
        );
        await expect(chartBuilderPage.notesZoom).toContainText("Group by");
      });
    });
  });

  // The server re-validates every spec, so its rejection path is forced.
  test("surface a rejected spec instead of failing silently", async ({
    chartBuilderPage,
    expectMutation,
  }) => {
    await test.step("reject the chart read", async () => {
      await chartBuilderPage.forceServerError(chartBuilder.series());
    });

    await test.step("open the chart builder", async () => {
      await chartBuilderPage.goto();
    });

    // The page opens empty and asks for nothing, so the failure has a request
    // to attach itself to only once a measure is picked.
    await test.step("tick a measure", async () => {
      await expectMutation(failing(chartBuilder.series()), () =>
        chartBuilderPage.tickMeasure("Books finished"),
      );
    });

    await test.step("check the page reports the rejection", async () => {
      await expect(chartBuilderPage.alert).toBeVisible();
    });
  });
});
