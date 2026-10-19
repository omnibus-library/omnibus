import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, waitFor, type within } from "storybook/test";
import type { Book } from "../../api";
import {
  failing,
  hanging,
  libraryHandler,
  searchHandler,
} from "../../testing/handlers";
import { aWireLibrary, uuidOf } from "../../testing/wire";
import { LibraryPicker } from "./LibraryPicker";

function Harness({
  already = [],
  height,
}: {
  already?: string[];
  /** A short box, so the next page's row stays out of the observer's reach. */
  height?: number;
}) {
  const [picked, setPicked] = useState<Book[]>([]);
  return (
    <div style={{ display: "flex", flexDirection: "column", height }}>
      <LibraryPicker
        picked={picked}
        onPicked={setPicked}
        already={new Set(already)}
        searchTestId="story-search"
      />
    </div>
  );
}

const meta = {
  title: "Components/LibraryPicker",
  component: Harness,
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(6), 100));
  },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const cards = (canvas: ReturnType<typeof within>) =>
  canvas.queryAllByTestId(/^picker-tile-/);

export const Browse: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("6 books")).toBeInTheDocument();
    await expect(cards(canvas)).toHaveLength(6);
    const first = canvas.getByTestId(`picker-tile-${uuidOf(1)}`);
    await expect(first).toHaveTextContent("Aurora Station, Vol. 1");
    await expect(first).toHaveTextContent("Sora Inkwell");
    await expect(first).toHaveTextContent("CBZ");
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.queryByTestId("picker-load-more")).toBeNull();
  },
};

export const BrowseLoadsMore: Story = {
  args: { height: 240 },
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(60), 48));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText("60 books")).toBeInTheDocument();
    await expect(cards(canvas)).toHaveLength(48);

    await userEvent.click(await canvas.findByTestId("picker-load-more"));

    await waitFor(() => expect(cards(canvas)).toHaveLength(60));
    await waitFor(() =>
      expect(canvas.queryByTestId("picker-load-more")).toBeNull(),
    );
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks"));
  },
  play: async ({ canvas }) => {
    const grid = await canvas.findByTestId("picker-loading");
    await expect(grid.querySelectorAll(".pick-card-skel")).toHaveLength(8);
    await expect(canvas.getByRole("status")).toHaveTextContent("Counting…");
  },
};

export const SearchCapped: Story = {
  beforeEach({ msw }) {
    msw.use(searchHandler(aWireLibrary(3), 2310));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("6 books");

    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search your library" }),
      "aurora",
    );

    await expect(
      await canvas.findByText("Showing 3 of 2310 matches · narrow your search"),
    ).toBeInTheDocument();
    await expect(cards(canvas)).toHaveLength(3);

    await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));

    await expect(await canvas.findByText("6 books")).toBeInTheDocument();
  },
};

export const SearchNone: Story = {
  beforeEach({ msw }) {
    msw.use(searchHandler([]));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("6 books");

    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search your library" }),
      "zzz",
    );

    await expect(
      await canvas.findByText("No books match “zzz”."),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("status")).toHaveTextContent("0 matches");
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t reach your library. Check your connection and try again.",
    );
  },
};

export const EmptyLibrary: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler([]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No books in your library yet."),
    ).toBeInTheDocument();
  },
};

export const ReviewPicks: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByTestId(`picker-tile-${uuidOf(2)}`),
    );
    await userEvent.click(canvas.getByTestId(`picker-tile-${uuidOf(4)}`));

    await expect(
      canvas.getByTestId(`picker-tile-${uuidOf(2)}`),
    ).toHaveAttribute("aria-pressed", "true");
    const review = canvas.getByRole("button", { name: "Picked (2)" });
    await userEvent.click(review);

    await expect(review).toHaveAttribute("aria-pressed", "true");
    await expect(cards(canvas)).toHaveLength(2);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "2 books picked",
    );

    await userEvent.click(canvas.getByTestId(`picker-tile-${uuidOf(2)}`));
    await userEvent.click(canvas.getByTestId(`picker-tile-${uuidOf(4)}`));

    await expect(canvas.getByText("Nothing picked yet.")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Picked (0)" }));

    await expect(await canvas.findByText("6 books")).toBeInTheDocument();
  },
};

export const OnShelfIsDisabled: Story = {
  args: { already: [uuidOf(1)] },
  play: async ({ canvas, userEvent }) => {
    const tile = await canvas.findByTestId(`picker-tile-${uuidOf(1)}`);
    await expect(tile).toHaveAttribute("aria-disabled", "true");
    await expect(tile).toHaveTextContent("On this shelf");
    await expect(tile).not.toHaveTextContent("CBZ");

    await userEvent.click(tile);

    await expect(tile).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.queryByRole("button", { name: /^Picked/ })).toBeNull();
  },
};
