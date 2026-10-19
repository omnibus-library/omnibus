import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor } from "storybook/test";
import { failing, hanging, seriesHandlers } from "../../testing/handlers";
import { aWireSeriesSummary } from "../../testing/wire";
import { Series } from "./Series";

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
];

const meta = {
  title: "Pages/Series",
  component: Series,
  parameters: { path: "/series" },
  beforeEach() {
    localStorage.removeItem("omnibus.discovery_prefs");
  },
  render: () => (
    <Routes>
      <Route path="/series" element={<Series />} />
    </Routes>
  ),
} satisfies Meta<typeof Series>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: SERIES }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "By series." }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("4 series · 33 books across them."),
    ).toBeInTheDocument();
    const cards = await canvas.findAllByTestId("series-card");
    await expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/series/4",
      "/series/2",
      "/series/1",
      "/series/3",
    ]);
    await expect(cards[3]).toHaveTextContent("The Wheel of Time");
    await expect(cards[3]).toHaveTextContent("Robert Jordan");
    await expect(cards[3]).toHaveTextContent("Books14");
    await expect(canvas.getByText("Time")).toHaveClass("idx-card-name-last");
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering every series"),
    ).toBeInTheDocument();
    await expect(canvas.queryAllByTestId("series-card")).toHaveLength(0);
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: [] }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "No series yet — index a library to see them here.",
      ),
    ).toBeInTheDocument();
  },
};

export const FilteredToNone: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: SERIES }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", { name: "Filter series" }),
      "zzz",
    );

    await expect(
      await canvas.findByText("No series match that filter."),
    ).toBeInTheDocument();
  },
};

export const FilterMatchesAuthor: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: SERIES }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", { name: "Filter series" }),
      "HERBERT",
    );

    await waitFor(() =>
      expect(canvas.getAllByTestId("series-card")).toHaveLength(1),
    );
    await expect(canvas.getByTestId("series-card")).toHaveTextContent("Dune");
  },
};

export const SortByCount: Story = {
  beforeEach({ msw }) {
    msw.use(...seriesHandlers({ list: SERIES }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Most books" }),
    );

    await expect(
      canvas.getByRole("button", { name: "Most books" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () =>
      expect(
        canvas
          .getAllByTestId("series-card")
          .map((card) => card.getAttribute("href")),
      ).toEqual(["/series/3", "/series/1", "/series/4", "/series/2"]),
    );
    await expect(
      JSON.parse(localStorage.getItem("omnibus.discovery_prefs") ?? "{}"),
    ).toMatchObject({ series_sort: "book_count" });
  },
};
