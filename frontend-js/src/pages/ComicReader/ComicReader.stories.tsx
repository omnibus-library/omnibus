import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, fireEvent, waitFor } from "storybook/test";
import type { ProgressUpdate } from "../../api/generated/schemas";
import { bookHandler, hanging } from "../../testing/handlers";
import {
  comicPageHandler,
  progressHandlers,
} from "../../testing/readerHandlers";
import { aWireBook, aWirePosition } from "../../testing/wire";
import { ComicReader } from "./ComicReader";

const BOOK = aWireBook({ formats: ["CBZ"], page_count: 5 });
const UUID = BOOK.unique_identifier;
const SAVED = aWirePosition({ epub_cfi: "comic-page:2", progress_percent: 60 });

const writes: ProgressUpdate[] = [];

const meta = {
  title: "Pages/ComicReader",
  component: ComicReader,
  parameters: { path: `/comic/${UUID}` },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(comicPageHandler, ...progressHandlers([], writes));
  },
  render: () => (
    <Routes>
      <Route path="/comic/:uuid" element={<ComicReader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof ComicReader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("comic-loading")).toHaveTextContent(
      "Taking it off the shelf",
    );
    await expect(
      canvas.getByRole("button", { name: "Back" }),
    ).toBeInTheDocument();
  },
};

export const MissingBook: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(aWireBook({ unique_identifier: "someone-else" })));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This comic could not be opened.",
    );
  },
};

export const NoPages: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(aWireBook({ formats: ["CBZ"], page_count: 0 })));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This comic could not be opened.",
    );
    await expect(canvas.queryByTestId("comic-page-image")).toBeNull();
  },
};

export const OpensAtTheSavedPage: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(BOOK), ...progressHandlers([SAVED], writes));
  },
  play: async ({ canvas }) => {
    const image = await canvas.findByTestId("comic-page-image");
    await expect(image).toHaveAttribute("src", `/api/ebooks/${UUID}/pages/2`);
    await expect(image).toHaveAccessibleName("Page 3");
    await expect(canvas.getByText("Page 3 of 5")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Sora Inkwell")).toBeInTheDocument();
    // The neighbours load hidden, so a turn paints from the cache.
    const prefetched = canvas
      .getByTestId("comic-stage")
      .querySelectorAll(".cr-prefetch");
    await expect([...prefetched].map((i) => i.getAttribute("src"))).toEqual([
      `/api/ebooks/${UUID}/pages/3`,
      `/api/ebooks/${UUID}/pages/1`,
    ]);
    await expect(writes).toEqual([]);
  },
};

export const SavesEveryTurn: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(BOOK), ...progressHandlers([SAVED], writes));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("comic-page-image");

    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await canvas.findByText("Page 4 of 5");
    await userEvent.keyboard("{ArrowLeft}");
    await canvas.findByText("Page 3 of 5");

    await waitFor(() => expect(writes).toHaveLength(2));
    await expect(writes[0]).toMatchObject({
      format: "epub",
      epub_cfi: "comic-page:3",
      progress_percent: 80,
    });
    await expect(writes[0]?.client_updated_at).toEqual(expect.any(Number));
    await expect(writes[1]).toMatchObject({
      epub_cfi: "comic-page:2",
      progress_percent: 60,
    });
  },
};

export const StopsAtTheEnds: Story = {
  beforeEach({ msw }) {
    msw.use(
      bookHandler(BOOK),
      ...progressHandlers(
        [aWirePosition({ epub_cfi: "comic-page:0" })],
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("comic-page-image");
    await expect(
      canvas.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();

    await userEvent.keyboard("{ArrowLeft}");

    await expect(canvas.getByText("Page 1 of 5")).toBeInTheDocument();
    await expect(writes).toEqual([]);
  },
};

export const SliderTurnsOnce: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(BOOK), ...progressHandlers([SAVED], writes));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("comic-page-image");
    const slider = canvas.getByRole("slider", { name: "Page slider" });

    // A focused slider steps itself; the key must not also reach the pager's own handler.
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.change(slider, { target: { value: "1" } });

    await canvas.findByText("Page 2 of 5");
    await waitFor(() => expect(writes).toHaveLength(1));
    await expect(writes[0]?.epub_cfi).toBe("comic-page:1");
  },
};

export const FitModes: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(BOOK), ...progressHandlers([SAVED], writes));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("comic-page-image");
    const fitHeight = canvas.getByRole("button", { name: "Fit height" });
    const fitWidth = canvas.getByRole("button", { name: "Fit width" });
    await expect(fitHeight).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(fitWidth);

    await expect(fitWidth).toHaveAttribute("aria-pressed", "true");
    await expect(fitHeight).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByTestId("comic-stage")).toHaveClass("cr-fit-width");
  },
};

export const BackLeavesForTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(BOOK), ...progressHandlers([SAVED], writes));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("comic-page-image");

    await userEvent.click(canvas.getByRole("button", { name: "Back" }));

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};
