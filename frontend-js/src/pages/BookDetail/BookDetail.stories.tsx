import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetEbookByUuidMockHandler404,
  getPostEbookOverridesMockHandler200,
} from "../../api/generated/omnibus.msw";
import { bookDetailHandlers, failing } from "../../testing/handlers";
import { aWireBook, aWireFile } from "../../testing/wire";
import { BookDetail } from "./BookDetail";

const BOOK = aWireBook({
  series_id: 4,
  formats: ["EPUB"],
  book_files: [aWireFile()],
  genres: ["Science fiction"],
  subjects: ["Space opera", "First contact"],
  description: `<p>${"A station at the edge of the map hears something answer. ".repeat(6)}</p>`,
});

const meta = {
  title: "Pages/BookDetail",
  component: BookDetail,
  parameters: { path: `/books/${BOOK.unique_identifier}` },
  // The page reads its uuid from the route, as it does under the app router.
  render: () => (
    <Routes>
      <Route path="/books/:uuid" element={<BookDetail />} />
    </Routes>
  ),
} satisfies Meta<typeof BookDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    const series = await canvas.findByRole("link", { name: "Aurora Station" });
    await waitFor(() =>
      expect(series.parentElement).toHaveTextContent(
        "Aurora Station · Book 1 · 3 in your library · 2021",
      ),
    );
    await expect(canvas.getByText("First contact")).toBeInTheDocument();

    const toggle = canvas.getByRole("button", { name: "Show more" });
    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

export const SectionRail: Story = {
  // Two short sections can't scroll far enough to pass the reading line.
  decorators: [
    (Story) => (
      <>
        <style>{".bdmq-flowsec { min-height: 100vh; }"}</style>
        <Story />
      </>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    const rail = await canvas.findByRole("navigation", {
      name: "Page sections",
    });
    const dots = within(rail).getAllByRole("button");
    const last = dots.at(-1) as HTMLElement;
    await expect(dots[0]).toHaveTextContent("01 · Home");
    await expect(dots[0]).toHaveClass("on");

    await userEvent.click(last);

    await waitFor(() => expect(last).toHaveClass("on"), { timeout: 5000 });
    await expect(dots[0]).not.toHaveClass("on");
    await expect(
      canvas.getByRole("button", { name: "↑ back to the book" }),
    ).toHaveClass("on");

    await userEvent.click(
      canvas.getByRole("button", { name: "↑ back to the book" }),
    );

    await waitFor(() => expect(dots[0]).toHaveClass("on"));
  },
};

const FOUND =
  "A station at the edge of the map hears something answer, and the crew must decide whether to reply.";

export const FetchSummaryReplacesASparseDescription: Story = {
  beforeEach({ msw }) {
    const sparse = aWireBook({ ...BOOK, description: "<p>Too short.</p>" });
    msw.use(
      ...bookDetailHandlers(sparse),
      http.get("/api/summary/sources", () =>
        HttpResponse.json(["GoogleBooks"]),
      ),
      http.post("/api/ebooks/:uuid/summary/fetch", () =>
        HttpResponse.json(FOUND),
      ),
      getPostEbookOverridesMockHandler200({
        ...sparse,
        description: `<p>${FOUND}</p>`,
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByText(FOUND)).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Fetch Summary" }),
    ).not.toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetEbookByUuidMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Book not found."),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the book",
    );
  },
};
