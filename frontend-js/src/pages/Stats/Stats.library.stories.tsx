import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { hanging } from "../../testing/handlers";
import {
  aWireLibraryComposition,
  aWireLibrarySize,
  aWireStatsSummary,
} from "../../testing/statsHandlers";
import { api, calls, Page } from "./Stats.stories.shared";

// The scope switch and the library scope: the shelf's own size and composition.

const meta = {
  title: "Pages/Stats/Library",
  component: Page,
  parameters: { path: "/stats" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;
type Clicker = { click: (element: Element) => Promise<void> };

const LIBRARY_TAB = { name: /^Library/ };
const USER_TAB = { name: /^User/ };

async function openLibrary(canvas: Canvas, userEvent: Clicker) {
  await userEvent.click(await canvas.findByRole("button", LIBRARY_TAB));
}

const unmeasured = { books: 0, total: 0 };
const NO_SLICES = { slices: [], coverage: unmeasured };

export const ScopeSwitchOffersTheUserAndTheShelf: Story = {
  play: async ({ canvas }) => {
    const user = await canvas.findByRole("button", USER_TAB);
    const library = canvas.getByRole("button", LIBRARY_TAB);
    await expect(user).toHaveTextContent("UserYour reading, this period");
    await expect(library).toHaveTextContent("LibraryThe shelf itself");
    await expect(user).toHaveAttribute("aria-pressed", "true");
    await expect(library).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.queryByText(/Whole shelf/)).toBeNull();
    await expect(canvas.getByTestId("stats-scope-user")).toBeInTheDocument();
  },
};

export const LibraryTabSwapsTheScopeAndBack: Story = {
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await expect(
      await canvas.findByTestId("stats-scope-library"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("stats-scope-user")).toBeNull();
    await expect(canvas.getByRole("button", LIBRARY_TAB)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      canvas.getByText("Whole shelf · not period-scoped"),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", USER_TAB));

    await expect(canvas.getByTestId("stats-scope-user")).toBeInTheDocument();
    await expect(canvas.queryByTestId("stats-scope-library")).toBeNull();
    await expect(canvas.queryByText(/Whole shelf/)).toBeNull();
  },
};

export const LibraryFiguresAreAbsentUntilTheTabIsOpened: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("stats-scope-user");
    await expect(canvas.queryByTestId("stats-library-size")).toBeNull();
    await expect(canvas.queryByTestId("stats-library-composition")).toBeNull();

    await openLibrary(canvas, userEvent);

    await expect(
      await canvas.findByTestId("stats-library-size"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByTestId("stats-library-composition"),
    ).toBeInTheDocument();
  },
};

export const ScopeSurvivesAReaderSwitch: Story = {
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);
    await canvas.findByTestId("stats-library-size");

    await userEvent.click(
      canvas.getByRole("button", { name: "Stats for You" }),
    );
    await userEvent.click(canvas.getByTestId("stats-reader-option-2"));

    await expect(await canvas.findByText("Grace's stats")).toBeInTheDocument();
    await expect(canvas.getByRole("button", LIBRARY_TAB)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByTestId("stats-scope-library")).toBeInTheDocument();
  },
};

export const LibraryReadsAreFetchedOncePerPage: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("stats-scope-user");
    await userEvent.click(canvas.getByRole("button", { name: "Year" }));
    await openLibrary(canvas, userEvent);
    await canvas.findByTestId("stats-library-composition");
    await userEvent.click(canvas.getByRole("button", USER_TAB));
    await userEvent.click(
      canvas.getByRole("button", { name: "Stats for You" }),
    );
    await userEvent.click(canvas.getByTestId("stats-reader-option-2"));
    await canvas.findByText("Grace's stats");

    // The shelf is the same for every reader and every period.
    await expect(calls.size).toHaveLength(1);
    await expect(calls.composition).toHaveLength(1);
  },
};

export const EmptyReaderShowsTheEmptyStateUnderEitherTab: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          aWireStatsSummary({
            range,
            reading_seconds: 0,
            listening_seconds: 0,
            books_finished: 0,
          }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("stats-empty")).toBeInTheDocument();

    await openLibrary(canvas, userEvent);

    await expect(canvas.getByTestId("stats-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("stats-library-size")).toBeNull();
  },
};

export const LibrarySizeShowsAPlaceholderUntilTheReadLands: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/library-size"));
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await expect(
      await canvas.findByText("Measuring the shelf"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("stats-library-size-loading"),
    ).toHaveAttribute("role", "status");
    // A placeholder never wears the card's testid, or a spec would read it as the card.
    await expect(canvas.queryByTestId("stats-library-size")).toBeNull();
  },
};

export const LibrarySizeStatesTheShelfInASentence: Story = {
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    const card = await canvas.findByTestId("stats-library-size");
    await expect(card.querySelector(".st-lib-sentence")).toHaveTextContent(
      "1,510 books. 412 million words waiting on the shelf.",
    );
    await expect(card.querySelector(".st-lib-accent")).toHaveTextContent(
      "412 million words",
    );
    const figures = within(card).getAllByTestId("stats-library-figure");
    await expect(figures.map((figure) => figure.textContent)).toEqual([
      "412M wordsacross 1,400 of 1,510 books",
      "1.5M est. pagesacross 1,500 of 1,510 books",
      "42 daysacross 90 of 1,510 books",
    ]);
  },
};

export const LibrarySizeSkipsFiguresNothingMeasured: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        size: aWireLibrarySize({
          pages: unmeasured,
          listening_seconds: unmeasured,
        }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    const card = await canvas.findByTestId("stats-library-size");
    await expect(
      within(card).getAllByTestId("stats-library-figure"),
    ).toHaveLength(1);
    await expect(card).not.toHaveTextContent("est. pages");
  },
};

export const LibrarySizeWithoutWordsStatesOnlyTheBooks: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ size: aWireLibrarySize({ words: unmeasured }) }));
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    const card = await canvas.findByTestId("stats-library-size");
    await expect(card.querySelector(".st-lib-sentence")).toHaveTextContent(
      /^1,510 books\.$/,
    );
    await expect(card.querySelector(".st-lib-accent")).toBeNull();
  },
};

export const LibrarySizeDrawsNothingWhenNothingIsMeasured: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        size: {
          books: 40,
          words: unmeasured,
          pages: unmeasured,
          listening_seconds: unmeasured,
        },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await canvas.findByTestId("stats-library-composition");
    await expect(canvas.queryByTestId("stats-library-size")).toBeNull();
    await expect(canvas.queryByTestId("stats-library-size-loading")).toBeNull();
  },
};

export const LibrarySizeDrawsNothingWhenTheReadFails: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ size: 500 }));
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await canvas.findByTestId("stats-library-composition");
    await expect(canvas.queryByTestId("stats-library-size")).toBeNull();
    await expect(canvas.queryByTestId("stats-library-size-loading")).toBeNull();
  },
};

export const CompositionDrawsFivePanelsInOrder: Story = {
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    const panels = await canvas.findByTestId("stats-library-composition");
    await expect(
      within(panels)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Formats", "Languages", "Publishers", "Published", "Genres"]);
    await expect(
      within(canvas.getByTestId("stats-composition-genres")).getByTestId(
        "stats-composition-note",
      ),
    ).toHaveTextContent("hand-assigned — across 1,510 of 1,510 books");
    await expect(
      within(canvas.getByTestId("stats-composition-languages")).getByTestId(
        "stats-composition-note",
      ),
    ).toHaveTextContent("across 1,510 of 1,510 books");
    // Nothing held in two formats, so the format panel has nothing to disclose.
    await expect(
      within(canvas.getByTestId("stats-composition-formats")).queryByTestId(
        "stats-composition-note",
      ),
    ).toBeNull();
  },
};

export const CompositionBarsScaleToTheLargestSlice: Story = {
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    const bars = within(
      await canvas.findByTestId("stats-composition-formats"),
    ).getAllByTestId("stats-composition-bar");
    await expect(bars.map((bar) => bar.textContent)).toEqual([
      "EPUB1,200",
      "M4B310",
    ]);
    await expect(bars[0]?.querySelector(".st-split-fill")).toHaveAttribute(
      "style",
      "width: 100%; background: var(--st-donut-c0);",
    );
    await expect(bars[1]?.querySelector(".st-split-fill")).toHaveAttribute(
      "style",
      "width: 25%; background: var(--st-donut-c1);",
    );
  },
};

export const CompositionDisclosesOverlapAndGhostedBooks: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        composition: aWireLibraryComposition({
          ghosted_books: 4,
          formats: {
            slices: [
              { label: "EPUB", books: 1_400 },
              { label: "M4B", books: 180 },
            ],
            coverage: { books: 1_510, total: 1_580 },
          },
        }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await expect(
      await canvas.findByText("+70 books held in more than one format"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("stats-composition-ghosted"),
    ).toHaveTextContent(
      "4 books excluded — no files on disk (paper copies, wishlist entries, removed files)",
    );
  },
};

export const CompositionDimensionWithNoDataSaysSo: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        composition: aWireLibraryComposition({
          languages: NO_SLICES,
          publishers: NO_SLICES,
          decades: NO_SLICES,
          genres: NO_SLICES,
        }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await canvas.findByTestId("stats-library-composition");
    await expect(
      canvas
        .getAllByTestId("stats-composition-empty")
        .map((empty) => empty.textContent),
    ).toEqual([
      "No language metadata yet.",
      "No publisher metadata yet.",
      "No publication dates yet.",
      "No genres assigned yet.",
    ]);
    // The formats panel still has bars, so the card renders.
    await expect(
      within(canvas.getByTestId("stats-composition-formats")).getAllByTestId(
        "stats-composition-bar",
      ),
    ).toHaveLength(2);
  },
};

export const CompositionShowsPlaceholderPanelsUntilTheReadLands: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/library-composition"));
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    const loading = await canvas.findByTestId(
      "stats-library-composition-loading",
    );
    await expect(
      within(loading).getByText("Sorting the collection"),
    ).toBeInTheDocument();
    await expect(loading.querySelectorAll(".st-comp-panel")).toHaveLength(3);
    await expect(canvas.queryByTestId("stats-library-composition")).toBeNull();
  },
};

export const CompositionDrawsNothingForAnEmptyLibraryOrAFailedRead: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ composition: { books: 0 } }));
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await canvas.findByTestId("stats-library-size");
    await waitFor(() =>
      expect(
        canvas.queryByTestId("stats-library-composition-loading"),
      ).toBeNull(),
    );
    await expect(canvas.queryByTestId("stats-library-composition")).toBeNull();
  },
};

export const CompositionDrawsNothingWhenTheReadFails: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ composition: 500 }));
  },
  play: async ({ canvas, userEvent }) => {
    await openLibrary(canvas, userEvent);

    await canvas.findByTestId("stats-library-size");
    await waitFor(() =>
      expect(
        canvas.queryByTestId("stats-library-composition-loading"),
      ).toBeNull(),
    );
    await expect(canvas.queryByTestId("stats-library-composition")).toBeNull();
  },
};
