import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { getGetSeriesByIdMockHandler404 } from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import { failing, hanging, seriesHandlers } from "../../testing/handlers";
import {
  aWireBook,
  aWireBookReading,
  aWireSeries,
  uuidOf,
} from "../../testing/wire";
import { SeriesDetail } from "./SeriesDetail";

const DAY = 86_400;

const HERBERT = { name: "Frank Herbert", role: "aut", file_as: null, id: 11 };

const book = (n: number, overrides: Parameters<typeof aWireBook>[0] = {}) =>
  aWireBook({
    id: n,
    title: `Dune book ${n}`,
    unique_identifier: uuidOf(n),
    cover_url: `/api/covers/${uuidOf(n)}`,
    formats: ["EPUB"],
    creators: [HERBERT],
    series: "Dune",
    series_index: String(n),
    series_id: 4,
    published: `${1964 + n}-01-15`,
    ...overrides,
  });

const BOOKS = [book(1), book(2), book(3), book(4)];

const SERIES = aWireSeries({
  id: 4,
  name: "Dune",
  book_count: 4,
  books: BOOKS,
});

const READING = [
  aWireBookReading({
    book_uuid: uuidOf(1),
    status: "finished",
    percent: 100,
  }),
  aWireBookReading({
    book_uuid: uuidOf(2),
    status: "reading",
    percent: 42,
    last_read_at: nowSecs() - 3 * DAY,
  }),
];

function LocationProbe() {
  const { pathname, state } = useLocation();
  return <p data-testid="location">{`${pathname} ${JSON.stringify(state)}`}</p>;
}

const meta = {
  title: "Pages/SeriesDetail",
  component: SeriesDetail,
  parameters: { path: "/series/4" },
  beforeEach({ msw }) {
    localStorage.removeItem("omnibus.landing_shelf");
    msw.use(...seriesHandlers({ detail: SERIES }));
  },
  render: () => (
    <Routes>
      <Route path="/series/:id" element={<SeriesDetail />} />
      <Route path="/series" element={<p>The series</p>} />
      <Route path="/" element={<LocationProbe />} />
    </Routes>
  ),
} satisfies Meta<typeof SeriesDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const serving = (detail: Parameters<typeof aWireSeries>[0]) =>
  seriesHandlers({ detail: aWireSeries(detail) });

export const Loaded: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByTestId("series-name")).toHaveTextContent(
      "Dune",
    );
    await expect(canvas.getByTestId("series-meta")).toHaveTextContent(
      "4 books · by Frank Herbert",
    );
    await expect(
      canvas.getByRole("link", { name: "Frank Herbert" }),
    ).toHaveAttribute("href", "/authors/11");
    await expect(canvas.getByTestId("series-back")).toHaveAttribute(
      "href",
      "/series",
    );
    await expect(canvas.getByTestId("series-back")).toHaveTextContent(
      "← All series",
    );
    await expect(canvasElement.querySelectorAll(".se-fan-cover")).toHaveLength(
      3,
    );
    await expect(canvas.getByTestId("series-pane")).toHaveStyle({
      "--au-accent": "oklch(0.555 0.153 28.4)",
    });
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Reading order" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", {
        name: "Open details for Dune book 1, Book 1 · 1965",
      }),
    ).toHaveAttribute("href", `/books/${uuidOf(1)}`);
    await expect(canvas.queryByTestId("series-gaps")).toBeNull();
    await waitFor(() => expect(document.title).toBe("Omnibus | Dune"));
  },
};

export const MoreAuthors: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...serving({
        id: 4,
        name: "Anthology",
        book_count: 3,
        books: [
          book(1, { creators: [HERBERT] }),
          book(2, {
            creators: [
              { name: "No Page", role: null, file_as: null, id: null },
            ],
          }),
          book(3, {
            creators: [
              { name: "Third Hand", role: "aut", file_as: null, id: 13 },
            ],
          }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    const meta = await canvas.findByTestId("series-meta");
    await expect(meta).toHaveTextContent(
      "3 books · by Frank Herbert, No Page and 1 more",
    );
    await expect(
      within(meta).getByRole("link", { name: "Frank Herbert" }),
    ).toBeInTheDocument();
    await expect(
      within(meta).queryByRole("link", { name: "No Page" }),
    ).toBeNull();
  },
};

export const Reading: Story = {
  beforeEach({ msw }) {
    msw.use(...serving({ ...SERIES, reading: READING }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("img", { name: "1 of 4 finished, 1 reading" }),
    ).toBeInTheDocument();
    const strip = canvas.getByTestId("series-reading");
    await expect(strip).toHaveTextContent("1 finished");
    await expect(strip).toHaveTextContent("1 reading");
    await expect(strip).toHaveTextContent("2 unread");
    const current = within(canvas.getByTestId("series-current"));
    await expect(
      current.getByRole("link", { name: "Dune book 2" }),
    ).toHaveAttribute("href", `/books/${uuidOf(2)}`);
    await expect(
      current.getByText("Book 2 · 42% · read 3 days ago"),
    ).toBeInTheDocument();
    await expect(current.getByTestId("series-resume")).toHaveAttribute(
      "href",
      `/read/${uuidOf(2)}`,
    );
    await expect(
      canvas.getByText("4 books · 1 finished", { selector: ".au-shelf-meta" }),
    ).toBeInTheDocument();
  },
};

export const Fresh: Story = {
  play: async ({ canvas }) => {
    const next = within(await canvas.findByTestId("series-next"));
    await expect(next.getByText("Start here · Book 1")).toBeInTheDocument();
    await expect(next.getByTestId("series-start")).toHaveAttribute(
      "href",
      `/read/${uuidOf(1)}`,
    );
    await expect(next.getByTestId("series-start")).toHaveTextContent("Start");
  },
};

export const KeptPosition: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...serving({
        ...SERIES,
        reading: [
          aWireBookReading({
            book_uuid: uuidOf(1),
            status: "unread",
            percent: 12,
            last_read_at: null,
            format: "epub",
          }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    const next = within(await canvas.findByTestId("series-next"));
    await expect(next.getByText("Up next · Book 1 · 12%")).toBeInTheDocument();
    await expect(next.getByTestId("series-resume")).toHaveTextContent("Resume");
  },
};

export const AllFinished: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...serving({
        ...SERIES,
        reading: BOOKS.map((_, i) =>
          aWireBookReading({
            book_uuid: uuidOf(i + 1),
            status: "finished",
            percent: 100,
          }),
        ),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("img", { name: "4 of 4 finished, 0 reading" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("series-current")).toBeNull();
    await expect(canvas.queryByTestId("series-next")).toBeNull();
  },
};

export const NoFormats: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...serving({
        ...SERIES,
        books: [book(1, { formats: [] }), ...BOOKS.slice(1)],
      }),
    );
  },
  play: async ({ canvas }) => {
    const next = within(await canvas.findByTestId("series-next"));
    await expect(
      next.getByRole("link", { name: "Dune book 1" }),
    ).toBeInTheDocument();
    await expect(next.queryByTestId("series-start")).toBeNull();
  },
};

export const Capped: Story = {
  beforeEach({ msw }) {
    msw.use(...serving({ ...SERIES, book_count: 10 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("First 4 of 10 books"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("series-reading")).toBeNull();
  },
};

export const Gaps: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...serving({
        ...SERIES,
        book_count: 3,
        books: [
          book(1),
          book(3, { series_index: "3" }),
          book(6, { series_index: "6" }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("series-gaps")).toHaveTextContent(
      "Not in your library: #2, #4–5",
    );
  },
};

export const NoBooks: Story = {
  beforeEach({ msw }) {
    msw.use(...serving({ id: 4, name: "Lost Saga", book_count: 0 }));
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByTestId("series-empty")).toHaveTextContent(
      "No books in this series are in your library.",
    );
    await expect(canvas.getByTestId("series-meta")).toHaveTextContent(
      "0 books",
    );
    await expect(canvasElement.querySelector(".au-avatar")).toHaveTextContent(
      "L",
    );
    await expect(canvas.queryByTestId("series-reading")).toBeNull();
    await expect(canvas.queryByRole("heading", { level: 3 })).toBeNull();
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
    await expect(
      canvas.getByRole("link", { name: "Back to series" }),
    ).toHaveAttribute("href", "/series");
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
    await expect(
      canvas.getByRole("link", { name: "Back to series" }),
    ).toHaveAttribute("href", "/series");
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

export const ShowInLibrary: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show in library" }),
    );

    await expect(await canvas.findByTestId("location")).toHaveTextContent(
      '/ {"clauses":[{"field":"series","mode":"include","values":["Dune"]}]}',
    );
    await expect(
      JSON.parse(localStorage.getItem("omnibus.landing_shelf") ?? "null"),
    ).toEqual({ kind: "all" });
  },
};
