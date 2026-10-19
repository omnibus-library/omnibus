import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect } from "storybook/test";
import { getGetSeriesByIdMockHandler404 } from "../../api/generated/omnibus.msw";
import { failing, hanging, seriesHandlers } from "../../testing/handlers";
import { aWireBook, aWireSeries, uuidOf } from "../../testing/wire";
import { SeriesDetail } from "./SeriesDetail";

const book = (n: number, overrides: Parameters<typeof aWireBook>[0] = {}) =>
  aWireBook({
    id: n,
    title: `Wheel book ${n}`,
    unique_identifier: uuidOf(n),
    cover_url: `/api/covers/${uuidOf(n)}`,
    series: "The Wheel of Time",
    series_index: String(n),
    ...overrides,
  });

const SERIES = aWireSeries({
  id: 4,
  name: "The Wheel of Time",
  book_count: 3,
  books: [
    book(1, {
      title: "The Eye of the World",
      published: "1990-01-15",
      accent: "oklch(0.55 0.12 150)",
      description: "<p>Rand al’Thor leaves the <em>Two Rivers</em>.</p>",
    }),
    book(2, {
      title: "The Great Hunt",
      published: "0101-01-01T00:00:00+00:00",
    }),
    book(3, {
      title: "The Dragon Reborn",
      series_index: null,
      published: "1991",
    }),
  ],
});

const meta = {
  title: "Pages/SeriesDetail",
  component: SeriesDetail,
  parameters: { path: "/series/4" },
  render: () => (
    <Routes>
      <Route path="/series/:id" element={<SeriesDetail />} />
    </Routes>
  ),
} satisfies Meta<typeof SeriesDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ detail: SERIES }));
  },
  play: async ({ canvas, canvasElement }) => {
    const title = await canvas.findByRole("heading", { level: 1 });
    await expect(title).toHaveTextContent("The Wheel of Time");
    await expect(title.querySelector("em")).toHaveTextContent("The");
    await expect(canvas.getByText("Series · 3 in library")).toBeInTheDocument();
    await expect(
      canvas.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["The Eye of the World", "The Great Hunt", "The Dragon Reborn"]);
    await expect(
      canvas.getByRole("link", { name: "The Eye of the World" }),
    ).toHaveAttribute("href", `/books/${uuidOf(1)}`);
    await expect(canvas.getByText("Book #1 · Jan 1990")).toBeInTheDocument();
    await expect(canvas.getByText("Book #2")).toBeInTheDocument();
    await expect(canvas.getByText("1991")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(".series-card-desc em"),
    ).toHaveTextContent("Two Rivers");
    await expect(canvasElement.querySelector(".disc-page")).toHaveStyle({
      "--accent": "oklch(0.55 0.12 150)",
    });
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series/:id"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering the series"),
    ).toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSeriesByIdMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Series not found."),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
  },
};

export const NoBooks: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...seriesHandlers({
        detail: aWireSeries({ id: 4, name: "Lost Saga", book_count: 0 }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No books in this series are in your library."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to series" }),
    ).toHaveAttribute("href", "/series");
  },
};
