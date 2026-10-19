import { FILTER_FIELDS } from "../data/libraryFilters";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Seeded so each menu lists real values and is measured at its full height.

const WIDE_WINDOWS = [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

test.describe("library filter menus", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  for (const viewport of WIDE_WINDOWS) {
    test.describe(`${viewport.width} wide`, () => {
      test.use({ viewport });

      for (const field of FILTER_FIELDS) {
        test(`open the ${field} menu inside the window`, async ({
          libraryPage,
        }) => {
          const { filterBar } = libraryPage;
          const { picker } = filterBar;

          await test.step("open the library", async () => {
            await libraryPage.goto();
          });

          await test.step(`open the ${field} facet`, async () => {
            await filterBar.openFacet(field);
            await expect(picker.root).toHaveAccessibleName(
              `Filter by ${field}`,
            );
            await expect(picker.loadingIndicator).toHaveCount(0);
          });

          await test.step("check the menu is on screen with Apply in reach", async () => {
            const insets = await picker.insets();
            for (const [edge, gap] of Object.entries(insets)) {
              expect(gap, `space past the ${edge} edge`).toBeGreaterThanOrEqual(
                0,
              );
            }
            await expect(picker.applyButton).toBeInViewport();
          });
        });
      }
    });
  }

  // The shelf page lays the bar out in its own column, so its menus are
  // placed against a different box than the landing's.
  test.describe("on the shelf page, 768 wide", () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    for (const field of FILTER_FIELDS) {
      test(`open the ${field} menu inside the window`, async ({
        readerShelfPage,
        filterShelf,
      }) => {
        const { filterBar } = readerShelfPage;
        const { picker } = filterBar;

        await test.step("open the shelf", async () => {
          await readerShelfPage.goto(filterShelf.id);
        });

        await test.step(`open the ${field} facet`, async () => {
          await filterBar.openFacet(field);
          await expect(picker.root).toHaveAccessibleName(`Filter by ${field}`);
          await expect(picker.loadingIndicator).toHaveCount(0);
        });

        await test.step("check the menu is on screen with Apply in reach", async () => {
          const insets = await picker.insets();
          for (const [edge, gap] of Object.entries(insets)) {
            expect(gap, `space past the ${edge} edge`).toBeGreaterThanOrEqual(
              0,
            );
          }
          await expect(picker.applyButton).toBeInViewport();
        });
      });
    }
  });

  test.describe("390 wide", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    for (const field of FILTER_FIELDS) {
      test(`open the ${field} menu as a bottom sheet`, async ({
        libraryPage,
      }) => {
        const { filterBar } = libraryPage;
        const { picker } = filterBar;

        await test.step("open the library", async () => {
          await libraryPage.goto();
        });

        await test.step(`open the ${field} facet`, async () => {
          await filterBar.openFacet(field);
          await expect(picker.root).toHaveAccessibleName(`Filter by ${field}`);
          await expect(picker.loadingIndicator).toHaveCount(0);
        });

        await test.step("check the sheet spans the foot of the window with Apply in reach", async () => {
          const insets = await picker.insets();
          expect(insets).toMatchObject({ left: 0, right: 0, bottom: 0 });
          expect(insets.top).toBeGreaterThanOrEqual(0);
          await expect(picker.applyButton).toBeInViewport();
        });
      });
    }
  });
});
