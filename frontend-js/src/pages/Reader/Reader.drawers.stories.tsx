import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor } from "storybook/test";
import { epubRelocate } from "../../testing/readerGlue";
import { readerFixture, UUID } from "../../testing/readerStory";
import { Reader } from "./Reader";

const r = readerFixture();

const HITS = [
  {
    cfi: "epubcfi(/6/8!/4/2/1:10)",
    excerpt: "the <b>long</b> dark",
    chapter: "The Long Dark",
  },
  { cfi: "epubcfi(/6/12!/4/6/1:0)", excerpt: "no chapter here", chapter: "" },
];

const meta = {
  title: "Pages/Reader/Drawers",
  component: Reader,
  parameters: { path: `/read/${UUID}` },
  beforeEach: ({ msw }) => r.setup(msw),
  render: () => (
    <Routes>
      <Route path="/read/:uuid" element={<Reader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof Reader>;

export default meta;
type Story = StoryObj<typeof meta>;

const calls = (method: string) =>
  r.glue.calls.filter((c) => c.method === method).map((c) => c.args);

export const ContentsWithoutATable: Story = {
  beforeEach: () => r.install({ toc: [] }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Contents" }),
    );

    await expect(
      await canvas.findByTestId("reader-toc-drawer"),
    ).toHaveTextContent("No table of contents.");
    await expect(canvas.queryByTestId("reader-toc-row")).toBeNull();
  },
};

export const ContentsListed: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(canvas.getByRole("button", { name: "Contents" }));

    const rows = await canvas.findAllByTestId("reader-toc-row");
    await expect(rows.map((row) => row.textContent)).toEqual([
      "Prologue",
      "Landfall",
      "The Long Dark",
    ]);
    await expect(rows[0]).toHaveClass("current");
    await expect(rows[1]).not.toHaveClass("current");
    await expect(rows[2]).toHaveStyle({ paddingLeft: "30px" });
    await expect(canvas.getByTestId("reader-toc-drawer")).toHaveTextContent(
      /1 \/ 20\s·\s5%/,
    );
  },
};

export const ContentsJumpToAChapter: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(canvas.getByRole("button", { name: "Contents" }));

    await userEvent.click(
      await canvas.findByRole("button", { name: "Landfall" }),
    );

    await waitFor(() => expect(calls("display")).toEqual([["landfall.xhtml"]]));
    await expect(canvas.queryByTestId("reader-toc-drawer")).toBeNull();
    // The outgoing chapter stays blank until the relocate that confirms the jump.
    await expect(await canvas.findByTestId("reader-loading")).toBeVisible();
    await expect(canvas.queryByTestId("reader-header-chapter")).toBeNull();

    window.__omnibusOnRelocate?.(
      epubRelocate({ cfi: "epubcfi(/6/4!/4)", chapterTitle: "Landfall" }),
    );

    await expect(
      await canvas.findByTestId("reader-header-chapter"),
    ).toHaveTextContent("Landfall");
    await waitFor(() => expect(r.writes).toHaveLength(1));
  },
};

export const SearchBeforeAQuery: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(
      canvas.getByRole("button", { name: "Search in book" }),
    );

    await expect(
      await canvas.findByTestId("reader-search-drawer"),
    ).toHaveTextContent("Type a query and press Enter.");
    await expect(canvas.getByTestId("reader-search-input")).toHaveFocus();
  },
};

export const SearchWhileTheGlueWalksTheBook: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(
      canvas.getByRole("button", { name: "Search in book" }),
    );

    await userEvent.type(
      await canvas.findByTestId("reader-search-input"),
      "  dark {Enter}",
    );

    await expect(
      await canvas.findByTestId("reader-search-loading"),
    ).toHaveTextContent("Searching the book");
    await expect(calls("search")).toEqual([["dark"]]);
    await expect(canvas.queryByText("No matches.")).toBeNull();
  },
};

export const SearchWithoutMatches: Story = {
  beforeEach: () => r.install({ searchResults: [] }),
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(
      canvas.getByRole("button", { name: "Search in book" }),
    );

    await userEvent.type(
      await canvas.findByTestId("reader-search-input"),
      "zzz{Enter}",
    );

    await expect(await canvas.findByText("No matches.")).toBeVisible();
  },
};

export const SearchHitsJumpToThePassage: Story = {
  beforeEach: () => r.install({ searchResults: HITS }),
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(
      canvas.getByRole("button", { name: "Search in book" }),
    );
    await userEvent.type(
      await canvas.findByTestId("reader-search-input"),
      "dark{Enter}",
    );

    const rows = await canvas.findAllByTestId("reader-search-row");

    await expect(canvas.getByText("2 matches · in this book")).toBeVisible();
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent("The Long Dark");
    // Excerpts are text: a tag in one is shown, not parsed.
    await expect(rows[0]).toHaveTextContent("the <b>long</b> dark");
    await expect(rows[1]?.querySelector(".rd-search-chapter")).toBeNull();

    await userEvent.click(rows[1] ?? canvas.getByText("no chapter here"));

    await waitFor(() => expect(calls("display")).toEqual([[HITS[1]?.cfi]]));
    await expect(canvas.queryByTestId("reader-search-drawer")).toBeNull();
  },
};

export const SearchInputKeepsItsArrowKeys: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(
      canvas.getByRole("button", { name: "Search in book" }),
    );
    await userEvent.type(
      await canvas.findByTestId("reader-search-input"),
      "ab{ArrowLeft}",
    );

    await expect(canvas.getByTestId("reader-search-input")).toHaveValue("ab");
    await expect(calls("prev")).toEqual([]);
  },
};

export const OpeningOneToolClosesTheOther: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(canvas.getByRole("button", { name: "Contents" }));
    await canvas.findByTestId("reader-toc-drawer");

    await userEvent.click(
      canvas.getByRole("button", { name: "Search in book" }),
    );

    await expect(
      await canvas.findByTestId("reader-search-drawer"),
    ).toBeVisible();
    await expect(canvas.queryByTestId("reader-toc-drawer")).toBeNull();
  },
};

export const EscapeClosesTheDrawerBeforeLeaving: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(canvas.getByRole("button", { name: "Contents" }));
    await canvas.findByTestId("reader-toc-drawer");

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-toc-drawer")).toBeNull(),
    );
    await expect(canvas.queryByText("Book page")).toBeNull();

    await userEvent.keyboard("{Escape}");

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};

export const TheCloseButtonAndScrimDismissADrawer: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await userEvent.click(canvas.getByRole("button", { name: "Contents" }));

    await userEvent.click(await canvas.findByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-toc-drawer")).toBeNull(),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Contents" }));
    await canvas.findByTestId("reader-toc-drawer");
    const scrim = canvasElement.querySelector<HTMLElement>(".rd-scrim");
    if (!scrim) throw new Error("the drawer drew no scrim");
    await userEvent.click(scrim);

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-toc-drawer")).toBeNull(),
    );
  },
};
