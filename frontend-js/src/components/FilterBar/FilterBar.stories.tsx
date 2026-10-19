import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { expect, within } from "storybook/test";
import type { FilterClause } from "../../api";
import { ADA } from "../../testing/AppHarness";
import { aShelf, userId } from "../../testing/books";
import { filterOptionHandlers, hanging } from "../../testing/handlers";
import { FilterBar } from "./FilterBar";
import type { ShelfList } from "./filters";

const TAGS = [
  { name: "space opera", count: 12 },
  { name: "cozy", count: 4 },
  { name: "Cozy", count: 2 },
];

const LOADED: ShelfList = {
  state: "loaded",
  shelves: [
    aShelf(),
    aShelf({ id: 4, name: "Book club", ownerId: userId(2), ownerName: "bo" }),
    aShelf({ id: 5, name: "Rules", kind: "smart" }),
  ],
};

// FilterBar keeps no clauses of its own; this holds them and prints the latest.
function Bar({
  initial = [],
  shelves = LOADED,
}: {
  initial?: FilterClause[];
  shelves?: ShelfList;
}) {
  const [clauses, setClauses] = useState(initial);
  return (
    <>
      <FilterBar
        clauses={clauses}
        shelves={shelves}
        viewerId={ADA.id}
        onChange={setClauses}
      />
      <code data-testid="clauses">{JSON.stringify(clauses)}</code>
    </>
  );
}

const meta = {
  title: "Components/FilterBar",
  component: Bar,
  beforeEach({ msw }) {
    msw.use(
      ...filterOptionHandlers({
        tags: TAGS,
        genres: [{ name: "Science Fiction", count: 40 }],
      }),
    );
  },
} satisfies Meta<typeof Bar>;

export default meta;
type Story = StoryObj<typeof meta>;

const include = (field: FilterClause["field"], ...values: string[]) =>
  ({ field, mode: "include", values }) satisfies FilterClause;

export const Inactive: Story = {
  play: async ({ canvas }) => {
    const group = canvas.getByRole("group", { name: "Library filters" });
    const facets = within(group)
      .getAllByRole("button")
      .map((b) => b.textContent);

    await expect(facets).toEqual([
      "Shelf",
      "Tag",
      "Genre",
      "Author",
      "Series",
      "Format",
    ]);
    await expect(
      canvas.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  },
};

export const ActiveFacet: Story = {
  args: {
    initial: [
      {
        field: "tag",
        mode: "exclude",
        values: ["space opera", "cozy", "dark"],
      },
      include("format", "epub"),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    const tag = canvas.getByRole("button", { name: /^Tag/ });
    await expect(tag).toHaveTextContent("Tagnot space opera +2");
    await expect(
      canvas.getByRole("button", { name: /^Format/ }),
    ).toHaveTextContent("FormatEPUB");

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear the Tag filter" }),
    );

    await expect(canvas.getByTestId("clauses")).toHaveTextContent(
      '[{"field":"format","mode":"include","values":["epub"]}]',
    );
    await expect(tag).toHaveFocus();

    await userEvent.click(canvas.getByRole("button", { name: "Clear all" }));
    await expect(canvas.getByTestId("clauses")).toHaveTextContent("[]");
  },
};

export const PickAndApply: Story = {
  play: async ({ canvas, userEvent }) => {
    const tag = canvas.getByRole("button", { name: "Tag" });
    await userEvent.click(tag);

    const dialog = canvas.getByRole("dialog", { name: "Filter by tag" });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(tag).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("button", { name: "Apply" })).toBeDisabled();
    // Names that differ only in case are one option, their counts added.
    await expect(
      await canvas.findByRole("checkbox", { name: "space opera" }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByRole("checkbox")).toHaveLength(2);
    await expect(within(dialog).getByText("6")).toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("checkbox", { name: "space opera" }),
    );
    await userEvent.click(canvas.getByRole("checkbox", { name: "cozy" }));
    await userEvent.click(canvas.getByRole("button", { name: "Apply (2)" }));

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("clauses")).toHaveTextContent(
      '[{"field":"tag","mode":"include","values":["space opera","cozy"]}]',
    );
    await expect(tag).toHaveFocus();
  },
};

export const ExcludeMode: Story = {
  args: { initial: [include("genre", "Science Fiction")] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Genre/ }));
    const includeMode = canvas.getByRole("button", { name: "Includes any" });
    const exclude = canvas.getByRole("button", { name: "Excludes any" });
    await expect(includeMode).toHaveAttribute("aria-pressed", "true");
    await expect(
      await canvas.findByRole("checkbox", { name: "Science Fiction" }),
    ).toBeChecked();

    await userEvent.click(exclude);
    await expect(exclude).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Apply (1)" }));

    await expect(
      canvas.getByRole("button", { name: /^Genre/ }),
    ).toHaveTextContent("Genrenot Science Fiction");
  },
};

export const UntickToClear: Story = {
  args: { initial: [include("genre", "Science Fiction")] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Genre/ }));
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: "Science Fiction" }),
    );

    // Nothing picked, but the field had values: Apply clears it.
    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await expect(canvas.getByTestId("clauses")).toHaveTextContent("[]");
  },
};

export const EscapeCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    const author = canvas.getByRole("button", { name: "Author" });
    await userEvent.click(author);
    await expect(canvas.getByRole("dialog")).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(author).toHaveFocus();
  },
};

export const ScrimCloses: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const author = canvas.getByRole("button", { name: "Author" });
    await userEvent.click(author);
    const scrim = canvasElement.querySelector(".fb-scrim");
    if (!(scrim instanceof HTMLElement))
      throw new Error("the scrim is missing");

    await userEvent.click(scrim);

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(author).toHaveFocus();
  },
};

export const AtClauseCap: Story = {
  args: {
    initial: Array.from({ length: 16 }, (_, i) => include("author", `A${i}`)),
  },
  play: async ({ canvas }) => {
    const tag = canvas.getByRole("button", { name: "Tag" });

    await expect(tag).toBeDisabled();
    await expect(tag).toHaveAttribute("title", "At most 16 filters");
    await expect(canvas.getByRole("button", { name: /^Author/ })).toBeEnabled();
  },
};

export const OptionsLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/tags"));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Tag" }));

    await expect(canvas.getByRole("status")).toHaveTextContent("Loading tags…");
    await expect(canvas.queryByText(/No tags yet/)).not.toBeInTheDocument();
  },
};

export const OptionsFailing: Story = {
  beforeEach({ msw }) {
    let calls = 0;
    msw.use(
      http.get("/api/tags", () =>
        ++calls === 1
          ? new HttpResponse("tags unavailable", { status: 500 })
          : HttpResponse.json(TAGS),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Tag" }));

    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("Couldn’t load tags.");
    await expect(alert).toHaveTextContent("tags unavailable");

    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));

    await expect(
      await canvas.findByRole("checkbox", { name: "space opera" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const AuthorAndSeriesCounts: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...filterOptionHandlers({
        authors: [{ id: 2, name: "Sora Inkwell", book_count: 7 }],
        series: [{ id: 4, name: "Aurora Station", book_count: 3 }],
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Series" }));
    const series = await canvas.findByRole("checkbox", {
      name: "Aurora Station",
    });
    await expect(series.closest("label")).toHaveTextContent("3");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByRole("button", { name: "Author" }));
    const author = await canvas.findByRole("checkbox", {
      name: "Sora Inkwell",
    });
    await expect(author.closest("label")).toHaveTextContent("7");
  },
};

export const NoValuesYet: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Author" }));

    await expect(
      await canvas.findByText("No authors yet."),
    ).toBeInTheDocument();
  },
};

export const SearchNoMatch: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/tags", () =>
        HttpResponse.json(
          Array.from({ length: 500 }, (_, i) => ({
            name: `tag ${i}`,
            count: 1,
          })),
        ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Tag" }));
    // 500 tags is a full cloud, drawn 200 at a time.
    await expect(await canvas.findAllByRole("checkbox")).toHaveLength(200);
    await expect(
      canvas.getByText(
        "Showing 200 of the 500 most-used tags · search narrows within them",
      ),
    ).toBeInTheDocument();

    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search tags" }),
      "zzz",
    );

    await expect(
      canvas.getByText("No tags match “zzz” among the 500 most-used."),
    ).toBeInTheDocument();
  },
};

export const ShelfFacetPending: Story = {
  args: { initial: [include("shelf", "3")], shelves: { state: "pending" } },
  play: async ({ canvas, userEvent }) => {
    const shelf = canvas.getByRole("button", { name: /^Shelf/ });
    await expect(shelf.querySelector(".ld-sheen")).toHaveTextContent("…");

    await userEvent.click(shelf);

    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Loading shelves…",
    );
  },
};

export const ShelfFacetLoaded: Story = {
  args: { initial: [include("shelf", "4", "9")] },
  play: async ({ canvas, userEvent }) => {
    const shelf = canvas.getByRole("button", { name: /^Shelf/ });
    await expect(shelf).toHaveTextContent("ShelfBook club · bo +1");

    await userEvent.click(shelf);

    // Smart shelves are not offered; a pick the list lacks stays so it can be unticked.
    await expect(
      canvas.getByRole("checkbox", { name: "Winter reads" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("checkbox", { name: "Rules" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("checkbox", { name: "unavailable shelf" }),
    ).toBeChecked();
  },
};

export const ShelfFacetFailed: Story = {
  args: { initial: [include("shelf", "3")], shelves: { state: "failed" } },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /^Shelf/ }),
    ).toHaveTextContent("unavailable shelf");
  },
};
