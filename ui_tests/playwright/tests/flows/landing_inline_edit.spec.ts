import { overrides } from "../contracts/overrides";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Reserved: every test here writes overrides and then drops them all, so they
// run one at a time and no other spec may read this book (alpha is
// metadata_edit's).
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-ocean")!;
const NEW_TAG = "Speculative Fiction";

test.describe("inline edit", () => {
  test.describe.configure({ mode: "default" });

  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the inline edit layout", async ({ libraryPage }) => {
    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await libraryPage.table.switchTo();
    });

    await test.step("check the shared nav shows", async () => {
      await libraryPage.topNav.assertDisplayed();
    });

    // The class is added only for admins, so it is the signal editing is on.
    await test.step("check the title cell is editable", async () => {
      const titleCell = libraryPage.table.cell(TARGET.slug, "title");
      await expect(titleCell).toBeVisible();
      await expect(titleCell).toHaveClass(/ebook-cell-editable/);
    });
  });

  test("edit a title inline", async ({
    libraryPage,
    expectMutation,
    revertOverridesOf,
  }) => {
    const table = libraryPage.table;
    await revertOverridesOf(TARGET.title);

    await test.step("open the title editor", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.openCell(TARGET.slug, "title");
      await expect(table.cellInput(TARGET.slug, "title")).toBeVisible();
    });

    await test.step("save a new title", async () => {
      await table.fillCell(TARGET.slug, "title", "Inline Edited");
      await expectMutation(overrides.save(), () =>
        table.commitCell(TARGET.slug, "title"),
      );
    });

    // The cell shows the metadata the save returned, and the click that
    // opened the editor did not open the book.
    await test.step("check the row shows the new title", async () => {
      await libraryPage.assertDisplayed();
      await expect(table.cell(TARGET.slug, "title")).toContainText(
        "Inline Edited",
      );
    });
  });

  test("keep the prior value when an inline edit fails", async ({
    libraryPage,
    expectMutation,
  }) => {
    const table = libraryPage.table;

    const priorTitle = await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
      return table.cellText(TARGET.slug, "title");
    });

    await test.step("save a new title while the server fails", async () => {
      await table.openCell(TARGET.slug, "title");
      await table.fillCell(TARGET.slug, "title", "Should Not Persist");
      await libraryPage.forceServerError(overrides.save());
      await expectMutation(failing(overrides.save()), () =>
        table.commitCell(TARGET.slug, "title"),
      );
    });

    // A failed save triggers no refetch, so the cell falls back to its prior value.
    await test.step("check the row shows the prior title", async () => {
      await expect(table.cell(TARGET.slug, "title")).toContainText(priorTitle);
    });
  });

  test("focus the inline title editor on open", async ({ libraryPage }) => {
    const table = libraryPage.table;

    await test.step("open the table view", async () => {
      await libraryPage.goto();
      await table.switchTo();
    });

    // `autofocus` does not focus a node a click handler mounts after hydration,
    // so the editor once swallowed the first keystroke (#2351).
    await test.step("open the title editor", async () => {
      await table.openCell(TARGET.slug, "title");
      await expect(table.cellInput(TARGET.slug, "title")).toBeFocused();
    });

    await test.step("close it with escape", async () => {
      await table.cancelCell(TARGET.slug, "title");
      await expect(table.cellInput(TARGET.slug, "title")).toHaveCount(0);
    });
  });

  test("open the authors chip editor inline", async ({ libraryPage }) => {
    const table = libraryPage.table;

    await test.step("open the authors editor", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.openCell(TARGET.slug, "author");
    });

    // The editor renders inside the cell, not in a sub-row.
    await test.step("check the editor shows the book's authors", async () => {
      await expect(table.cellInput(TARGET.slug, "author")).toBeVisible();
      for (const name of TARGET.authors) {
        await expect(table.chip(TARGET.slug, "author", name)).toBeVisible();
      }
    });

    // The dropdown opens on focus with the library-wide author pool.
    await test.step("check the suggestions show", async () => {
      await expect(table.cellSuggestions(TARGET.slug, "author")).toBeVisible();
      await expect(
        table.suggestionHeading(TARGET.slug, "author", "ADD AUTHOR"),
      ).toBeVisible();
    });

    await test.step("close it with escape", async () => {
      await table.cancelCell(TARGET.slug, "author");
      await expect(table.cellInput(TARGET.slug, "author")).toHaveCount(0);
    });
  });

  // The authors editor once closed only on Escape, so blurring away left its
  // highlight stuck (#992).
  test("close the authors editor on clicking away", async ({ libraryPage }) => {
    const table = libraryPage.table;

    await test.step("open the authors editor", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.openCell(TARGET.slug, "author");
      await expect(table.cellInput(TARGET.slug, "author")).toBeVisible();
      await expect(table.cell(TARGET.slug, "author")).toHaveClass(
        /ebook-cell-editing/,
      );
    });

    await test.step("click the page heading", async () => {
      await libraryPage.clickAway();
    });

    await test.step("check the editor closed", async () => {
      await expect(table.cellInput(TARGET.slug, "author")).toHaveCount(0);
      await expect(table.cell(TARGET.slug, "author")).not.toHaveClass(
        /ebook-cell-editing/,
      );
    });
  });

  test("tab back from the authors input to a remove button", async ({
    libraryPage,
  }) => {
    const table = libraryPage.table;

    await test.step("open the authors editor", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.openCell(TARGET.slug, "author");
      await expect(table.cellInput(TARGET.slug, "author")).toBeVisible();
    });

    // The chips sit before the input, so Shift+Tab lands on the last chip's Remove
    // button, and the blur must not close an editor focus is still inside.
    await test.step("tab back from the input", async () => {
      await table.tabBackFromCell(TARGET.slug, "author");
    });

    await test.step("check the remove button has focus and the editor stays open", async () => {
      await expect(
        table.removeAuthorButton(TARGET.slug, TARGET.authors.at(-1)!),
      ).toBeFocused();
      await expect(table.cellInput(TARGET.slug, "author")).toBeVisible();
      await expect(table.cell(TARGET.slug, "author")).toHaveClass(
        /ebook-cell-editing/,
      );
    });
  });

  test("pick an author suggestion without closing the editor", async ({
    libraryPage,
    expectMutation,
    revertOverridesOf,
  }) => {
    const table = libraryPage.table;
    const grace = /Grace Hopper/;
    await revertOverridesOf(TARGET.title);

    await test.step("search the authors editor for a suggestion", async () => {
      await libraryPage.goto();
      await table.switchTo();
      await table.openCell(TARGET.slug, "author");
      await table.fillCell(TARGET.slug, "author", "Grace");
      await expect(
        table.suggestion(TARGET.slug, "author", grace),
      ).toBeVisible();
    });

    // Picking commits on `mousedown` with the default prevented, so the input
    // never blurs and the editor must stay open for more authors.
    await test.step("pick the suggestion", async () => {
      await expectMutation(overrides.save(), () =>
        table.chooseSuggestion(TARGET.slug, "author", grace),
      );
      await expect(
        table.chip(TARGET.slug, "author", "Grace Hopper"),
      ).toBeVisible();
      await expect(table.cellInput(TARGET.slug, "author")).toBeVisible();
      await expect(table.cell(TARGET.slug, "author")).toHaveClass(
        /ebook-cell-editing/,
      );
    });

    // A click away must still close an editor whose input skipped the blur.
    await test.step("click away from the editor", async () => {
      await libraryPage.clickAway();
      await expect(table.cellInput(TARGET.slug, "author")).toHaveCount(0);
      await expect(table.cell(TARGET.slug, "author")).not.toHaveClass(
        /ebook-cell-editing/,
      );
    });
  });

  test.describe("tags cell", () => {
    test("open the tags chip editor inline", async ({ libraryPage }) => {
      const table = libraryPage.table;

      await test.step("open the tags editor", async () => {
        await libraryPage.goto();
        await table.switchTo();
        await table.openCell(TARGET.slug, "tags");
      });

      // The editor renders inside the cell, as the authors one does.
      await test.step("check the editor shows", async () => {
        await expect(table.cellInput(TARGET.slug, "tags")).toBeVisible();
        await expect(table.cellInput(TARGET.slug, "tags")).toHaveAttribute(
          "placeholder",
          "+ add tag…",
        );
        await expect(table.cell(TARGET.slug, "tags")).toHaveClass(
          /ebook-cell-editing/,
        );
      });

      await test.step("close it with escape", async () => {
        await table.cancelCell(TARGET.slug, "tags");
        await expect(table.cellInput(TARGET.slug, "tags")).toHaveCount(0);
        await expect(table.cell(TARGET.slug, "tags")).not.toHaveClass(
          /ebook-cell-editing/,
        );
      });
    });

    test("create a new tag inline", async ({
      libraryPage,
      expectMutation,
      revertOverridesOf,
    }) => {
      const table = libraryPage.table;
      await revertOverridesOf(TARGET.title);

      await test.step("open the tags editor", async () => {
        await libraryPage.goto();
        await table.switchTo();
        await table.openCell(TARGET.slug, "tags");
        await expect(table.cellInput(TARGET.slug, "tags")).toBeVisible();
      });

      // Nothing in the pool matches, so Enter commits the typed text as a new
      // tag and posts the full `subjects` override.
      await test.step("type a new tag and save it", async () => {
        await table.fillCell(TARGET.slug, "tags", NEW_TAG);
        await expectMutation(overrides.save(), () =>
          table.commitCell(TARGET.slug, "tags"),
        );
        await expect(table.chip(TARGET.slug, "tags", NEW_TAG)).toBeVisible();
      });
    });

    // The override save materializes a `tags` row, so a page loaded after it
    // finds the tag in the autocomplete pool.
    test("autocomplete a tag from the pool", async ({
      libraryPage,
      overridesRequests,
      expectMutation,
      revertOverridesOf,
      request,
    }) => {
      const table = libraryPage.table;
      await revertOverridesOf(TARGET.title);

      await test.step("give the book the tag through the api", async () => {
        const uuid = await fetchBookUuidByTitle(request, TARGET.title);
        const saved = await overridesRequests.postOverrides(uuid, {
          subjects: [NEW_TAG],
        });
        await expect(saved).toBeOK();
      });

      await test.step("open the tags editor", async () => {
        await libraryPage.goto();
        await table.switchTo();
        await table.openCell(TARGET.slug, "tags");
        await expect(table.cellInput(TARGET.slug, "tags")).toBeVisible();
      });

      // The dropdown leaves out tags already on the book, so the chip goes first.
      await test.step("remove the tag from the book", async () => {
        await expectMutation(overrides.save(), () =>
          table.removeTag(TARGET.slug, NEW_TAG),
        );
      });

      await test.step("type a prefix of the tag", async () => {
        await table.fillCell(TARGET.slug, "tags", "Specul");
        await expect(table.cellSuggestions(TARGET.slug, "tags")).toBeVisible();
        await expect(
          table.suggestionHeading(TARGET.slug, "tags", "ADD TAG"),
        ).toBeVisible();
        await expect(
          table.suggestion(TARGET.slug, "tags", /Speculative Fiction/),
        ).toBeVisible();
      });

      await test.step("pick the suggestion", async () => {
        await expectMutation(overrides.save(), () =>
          table.chooseSuggestion(TARGET.slug, "tags", /Speculative Fiction/),
        );
        await expect(table.chip(TARGET.slug, "tags", NEW_TAG)).toBeVisible();
      });
    });
  });
});
