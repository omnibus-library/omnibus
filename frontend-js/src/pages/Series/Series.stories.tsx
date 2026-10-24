import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link, Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { getGetSeriesByIdMockHandler200 } from "../../api/generated/omnibus.msw";
import { forgetScrollPositions } from "../../scrollRestore";
import { failing, hanging, seriesHandlers } from "../../testing/handlers";
import {
  aWireSeries,
  aWireSeriesReading,
  aWireSeriesSummary,
} from "../../testing/wire";
import { SeriesDetail } from "../SeriesDetail/SeriesDetail";
import { Series, SeriesIndexPane } from "./Series";

const SERIES = [
  aWireSeriesSummary({
    id: 1,
    name: "Foundation",
    primary_author: "Isaac Asimov",
    book_count: 7,
  }),
  aWireSeriesSummary({
    id: 2,
    name: "Dune",
    primary_author: "Frank Herbert",
    book_count: 6,
  }),
  aWireSeriesSummary({
    id: 3,
    name: "The Wheel of Time",
    primary_author: "Robert Jordan",
    book_count: 14,
  }),
  aWireSeriesSummary({
    id: 4,
    name: "The Culture",
    primary_author: "Iain M. Banks",
    book_count: 6,
  }),
  aWireSeriesSummary({
    id: 5,
    name: "1632",
    primary_author: "Eric Flint",
    book_count: 3,
  }),
];

// Dune was read last, so it is the series `/series` previews.
const READING = [
  aWireSeriesReading({
    series_id: 2,
    finished: 2,
    reading: 1,
    last_read_at: 300,
  }),
  aWireSeriesReading({
    series_id: 1,
    finished: 1,
    reading: 0,
    last_read_at: 200,
  }),
];

const seriesPage = getGetSeriesByIdMockHandler200(({ params }) => {
  const id = Number(params.id);
  const known = SERIES.find((s) => s.id === id);
  return aWireSeries({ id, name: known?.name ?? "Unknown", book_count: 0 });
});

const seriesRoute = (
  <Route path="/series" element={<Series />}>
    <Route index element={<SeriesIndexPane />} />
    <Route path=":id" element={<SeriesDetail />} />
  </Route>
);
const seriesRoutes = <Routes>{seriesRoute}</Routes>;

const meta = {
  title: "Pages/Series",
  component: Series,
  parameters: { path: "/series" },
  beforeEach({ msw }) {
    localStorage.removeItem("omnibus.discovery_prefs");
    msw.use(seriesPage);
    // The window and the saved offsets outlive a story, so each starts clean.
    const reset = () => {
      forgetScrollPositions();
      window.scrollTo(0, 0);
    };
    reset();
    return reset;
  },
  render: () => seriesRoutes,
} satisfies Meta<typeof Series>;

export default meta;
type Story = StoryObj<typeof meta>;

const withSeries = (reading = READING) =>
  seriesHandlers({ list: SERIES, reading });

const labelsOf = (rows: HTMLElement[]) =>
  rows.map((row) => row.getAttribute("aria-label"));

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Series 5" }),
    ).toBeInTheDocument();
    const list = canvas.getByRole("complementary", { name: "Series" });
    const rows = await within(list).findAllByTestId("series-card");
    await expect(labelsOf(rows)).toEqual([
      "The Culture, by Iain M. Banks, 6 books",
      "Dune, by Frank Herbert, 6 books, 2 finished",
      "Foundation, by Isaac Asimov, 7 books, 1 finished",
      "The Wheel of Time, by Robert Jordan, 14 books",
      "1632, by Eric Flint, 3 books",
    ]);
    await expect(rows[0]).toHaveTextContent("The CultureIain M. Banks");
    await expect(rows[0]).toHaveClass("au-row", "se-row");
    const rail = canvas.getByRole("navigation", { name: "Jump to letter" });
    await expect(within(rail).getByRole("link", { name: "D" })).toHaveAttribute(
      "href",
      "#letter-D",
    );
    await expect(
      within(rail).getByTestId("series-letter-hash"),
    ).toHaveAttribute("href", "#letter-hash");
    await expect(within(rail).queryByRole("link", { name: "Q" })).toBeNull();
    // The shown series, Dune, files under D.
    await expect(within(rail).getByRole("link", { name: "D" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expect(canvas.getByTestId("series-list")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Omnibus | Series"));
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series"), hanging("/api/series/reading"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering every series"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Series" }),
    ).toBeInTheDocument();
    await expect(canvas.queryAllByTestId("series-card")).toHaveLength(0);
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series", 500), ...withSeries().slice(1));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t load series: failed with 500",
    );
    await expect(canvas.getByText("Couldn’t load series.")).toBeInTheDocument();
    // No count beside the title when there is nothing to count.
    await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe(
      "Series",
    );
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: [] }));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(
        canvas.getAllByText(
          "No series yet — no book in the library belongs to one.",
        ),
      ).toHaveLength(2),
    );
  },
};

export const FilteredToNone: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", {
        name: "Filter series by name or author",
      }),
      "zzz",
    );

    await expect(
      await canvas.findByText("No series match."),
    ).toBeInTheDocument();
  },
};

export const FilterMatchesAuthor: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", {
        name: "Filter series by name or author",
      }),
      "HERBERT",
    );

    await waitFor(() =>
      expect(canvas.getAllByTestId("series-card")).toHaveLength(1),
    );
    await expect(canvas.getByTestId("series-card")).toHaveAccessibleName(
      "Dune, by Frank Herbert, 6 books, 2 finished",
    );
  },
};

export const SortByCount: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, userEvent }) => {
    const sort = within(
      await canvas.findByRole("group", { name: "Sort series" }),
    );

    await userEvent.click(sort.getByRole("button", { name: "Most books" }));

    await expect(
      sort.getByRole("button", { name: "Most books" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () =>
      expect(
        canvas
          .getAllByTestId("series-card")
          .map((card) => card.getAttribute("href")),
      ).toEqual([
        "/series/3",
        "/series/1",
        "/series/4",
        "/series/2",
        "/series/5",
      ]),
    );
    await expect(
      canvas.queryByRole("navigation", { name: "Jump to letter" }),
    ).toBeNull();
    await expect(
      JSON.parse(localStorage.getItem("omnibus.discovery_prefs") ?? "{}"),
    ).toMatchObject({ series_sort: "book_count" });
  },
};

export const RecentWaitsOnReading: Story = {
  beforeEach({ msw }) {
    msw.use(
      seriesHandlers({ list: SERIES })[0],
      hanging("/api/series/reading"),
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const chip = await canvas.findByRole("button", { name: /Reading/ });
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveAttribute("aria-busy", "true");

    await userEvent.click(canvas.getByRole("button", { name: "Recent" }));

    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-testid="series-list"] .ld-rows'),
      ).not.toBeNull(),
    );
    await expect(canvas.queryAllByTestId("series-card")).toHaveLength(0);
  },
};

const RECENT_ORDER = [
  "/series/2",
  "/series/1",
  "/series/4",
  "/series/3",
  "/series/5",
];

export const RecentOrdersByLastRead: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, userEvent }) => {
    const chip = await canvas.findByRole("button", { name: "Reading 1" });
    await waitFor(() => expect(chip).toBeEnabled());

    await userEvent.click(canvas.getByRole("button", { name: "Recent" }));

    await waitFor(() =>
      expect(
        canvas
          .getAllByTestId("series-card")
          .map((card) => card.getAttribute("href")),
      ).toEqual(RECENT_ORDER),
    );
    await expect(
      JSON.parse(localStorage.getItem("omnibus.discovery_prefs") ?? "{}"),
    ).toMatchObject({ series_sort: "recent" });
  },
};

export const StoredRecentSortIsPressed: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
    localStorage.setItem(
      "omnibus.discovery_prefs",
      '{"authors_sort":"name","series_sort":"recent","shelves_sort":"name"}',
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Recent" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("button", { name: "A–Z" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() =>
      expect(
        canvas
          .getAllByTestId("series-card")
          .map((card) => card.getAttribute("href")),
      ).toEqual(RECENT_ORDER),
    );
  },
};

export const ReadingFilter: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, userEvent }) => {
    const chip = await canvas.findByRole("button", { name: "Reading 1" });
    await waitFor(() => expect(chip).toBeEnabled());

    await userEvent.click(chip);

    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(canvas.getAllByTestId("series-card")).toHaveLength(1),
    );
    await expect(canvas.getByTestId("series-card")).toHaveAccessibleName(
      "Dune, by Frank Herbert, 6 books, 2 finished",
    );
  },
};

export const ReadingFailed: Story = {
  beforeEach({ msw }) {
    msw.use(
      seriesHandlers({ list: SERIES })[0],
      failing("get", "/api/series/reading", 500),
    );
  },
  play: async ({ canvas }) => {
    const bars = await canvas.findAllByTestId("series-row-bar");
    await waitFor(() => {
      for (const bar of bars)
        expect(bar).toHaveAttribute("data-state", "unknown");
    });
    await expect(
      canvas.getByRole("button", { name: /Reading/ }),
    ).toBeDisabled();
  },
};

export const PreviewsTheLastReadSeries: Story = {
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Dune" }),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector(".au-page")).toHaveAttribute(
      "data-pane",
      "index",
    );

    const row = canvas.getByRole("link", { name: /^Dune, / });
    await expect(row).toHaveClass("is-shown");
    await expect(row).not.toHaveAttribute("aria-current");
    await expect(canvas.queryByTestId("series-back")).toBeNull();
  },
};

export const DeepLink: Story = {
  parameters: { path: "/series/3" },
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  play: async ({ canvas, canvasElement }) => {
    const row = await canvas.findByRole("link", {
      name: "The Wheel of Time, by Robert Jordan, 14 books",
    });

    await expect(canvasElement.querySelector(".au-page")).toHaveAttribute(
      "data-pane",
      "series",
    );
    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(
      await canvas.findByRole("heading", {
        level: 2,
        name: "The Wheel of Time",
      }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("series-back")).toBeInTheDocument();
  },
};

// Forty rows, so the last one sits well below the first screen.
const MANY = Array.from({ length: 40 }, (_, n) =>
  aWireSeriesSummary({
    id: n + 1,
    name: `Series ${String(n).padStart(2, "0")}`,
    sort: `Series ${String(n).padStart(2, "0")}`,
    primary_author: null,
    book_count: 1,
  }),
);

const manyPages = getGetSeriesByIdMockHandler200(({ params }) => {
  const id = Number(params.id);
  return aWireSeries({ id, name: MANY[id - 1]?.name, book_count: 0 });
});

export const DeepLinkScrollsToTheRow: Story = {
  parameters: { path: "/series/40" },
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: MANY }), manyPages);
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Series 39, 1 book" }),
    ).toHaveAttribute("aria-current", "page");

    await waitFor(() =>
      expect(canvas.getByTestId("series-list").scrollTop).toBeGreaterThan(0),
    );
  },
};

const nextFrame = () => new Promise((frame) => requestAnimationFrame(frame));

/** Scrolls the window and waits out the frame that fires the scroll event and the one that records it. */
async function scrollWindowTo(y: number) {
  window.scrollTo(0, y);
  await waitFor(() => expect(window.scrollY).toBe(y));
  await nextFrame();
  await nextFrame();
}

const pageHeadingOf = (name: string) => ({ level: 2, name }) as const;

export const SwitchingSeriesMovesTheWindow: Story = {
  parameters: { path: "/series/12" },
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: MANY }), manyPages);
  },
  render: () => <div style={{ minHeight: "300vh" }}>{seriesRoutes}</div>,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("heading", pageHeadingOf("Series 11"));
    const list = await canvas.findByTestId("series-list");
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
    const listTop = list.scrollTop;
    await scrollWindowTo(400);

    await userEvent.click(
      await canvas.findByRole("link", { name: /^Series 12, / }),
    );
    await canvas.findByRole("heading", pageHeadingOf("Series 12"));
    await waitFor(() => expect(window.scrollY).toBe(0));
    await expect(list.scrollTop).toBe(listTop);

    await userEvent.click(
      await canvas.findByRole("link", { name: /^Series 11, / }),
    );
    await canvas.findByRole("heading", pageHeadingOf("Series 11"));
    await waitFor(() => expect(window.scrollY).toBe(400));
    await expect(list.scrollTop).toBe(listTop);
  },
};

const leaveAndReturn = (
  <div style={{ minHeight: "300vh" }}>
    {/* Fixed, so a click never scrolls the window to reach the link. */}
    <nav style={{ position: "fixed", bottom: 0, right: 0, zIndex: 10 }}>
      <Link to="/elsewhere">Leave series</Link>
      <Link to="/series/2">Return to series</Link>
    </nav>
    <Routes>
      {seriesRoute}
      <Route path="/elsewhere" element={<p>Elsewhere</p>} />
    </Routes>
  </div>
);

export const ReturningToSeriesRestoresTheWindow: Story = {
  parameters: { path: "/series/2" },
  beforeEach({ msw }) {
    msw.use(...withSeries());
  },
  render: () => leaveAndReturn,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("heading", pageHeadingOf("Dune"));
    await scrollWindowTo(400);

    await userEvent.click(canvas.getByRole("link", { name: "Leave series" }));
    await canvas.findByText("Elsewhere");
    window.scrollTo(0, 0);
    await nextFrame();
    await userEvent.click(
      canvas.getByRole("link", { name: "Return to series" }),
    );

    await canvas.findByRole("heading", pageHeadingOf("Dune"));
    await waitFor(() => expect(window.scrollY).toBe(400));
  },
};
