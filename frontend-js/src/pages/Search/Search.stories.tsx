import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect } from "storybook/test";
import { hanging, paletteHandler } from "../../testing/handlers";
import { aWirePalette } from "../../testing/wire";
import { Search } from "./Search";

const meta = {
  title: "Pages/Search",
  component: Search,
  parameters: { path: "/search/aurora" },
  // The page reads its query from the route, as it does under the app router.
  render: () => (
    <Routes>
      <Route path="/search/:query" element={<Search />} />
    </Routes>
  ),
} satisfies Meta<typeof Search>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Results: Story = {
  beforeEach({ msw }) {
    msw.use(paletteHandler(aWirePalette()));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1 }),
    ).toHaveTextContent("5 results for “aurora”");
    await expect(canvas.getByTestId("search-result-count")).toHaveTextContent(
      "1 title · 1 author · 1 series · 1 tag · 1 genre · fts5 · 18ms",
    );
  },
};

export const ClickedFacet: Story = {
  parameters: { path: `/search/${encodeURIComponent('tag:"space opera"')}` },
  beforeEach({ msw }) {
    msw.use(paletteHandler(aWirePalette()));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1 }),
    ).toHaveTextContent("5 results for “space opera”");
  },
};

export const NoResults: Story = {
  beforeEach({ msw }) {
    msw.use(
      paletteHandler(
        aWirePalette({
          books: [],
          authors: [],
          series: [],
          tags: [],
          genres: [],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1 }),
    ).toHaveTextContent("No results for “aurora”");
    await expect(canvas.getByTestId("search-result-count")).toHaveTextContent(
      "0 results · fts5 · 18ms",
    );
  },
};

export const Searching: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/search/palette"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Searching the shelves",
    );
  },
};

const tags = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `space opera ${i + 1}`,
    book_count: 2,
  }));

export const ShowAll: Story = {
  beforeEach({ msw }) {
    msw.use(
      paletteHandler(
        aWirePalette({ tags: tags(5), tag_total: 7 }),
        aWirePalette({ tags: tags(7), tag_total: 7 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findAllByTestId("search-tag-row")).toHaveLength(
      5,
    );

    await userEvent.click(canvas.getByRole("button", { name: "Show all 7" }));

    await expect(
      await canvas.findByRole("button", { name: "Show fewer" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getAllByTestId("search-tag-row")).toHaveLength(7);
  },
};

export const ShowAllFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      paletteHandler(aWirePalette({ tags: tags(5), tag_total: 7 }), "fails"),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show all 7" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t load the rest — try again.",
    );
  },
};
