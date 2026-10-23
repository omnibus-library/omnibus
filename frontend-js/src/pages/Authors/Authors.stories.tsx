import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { getGetAuthorByIdMockHandler200 } from "../../api/generated/omnibus.msw";
import { authorsHandlers, failing, hanging } from "../../testing/handlers";
import {
  aWireAuthor,
  aWireAuthorReading,
  aWireAuthorSummary,
} from "../../testing/wire";
import { AuthorDetail } from "../AuthorDetail/AuthorDetail";
import { Authors, AuthorsIndexPane } from "./Authors";

const AUTHORS = [
  aWireAuthorSummary({
    id: 1,
    name: "Ursula K. Le Guin",
    sort: "Le Guin, Ursula K.",
    book_count: 3,
  }),
  aWireAuthorSummary({
    id: 2,
    name: "Octavia E. Butler",
    sort: "Butler, Octavia E.",
    book_count: 5,
  }),
  aWireAuthorSummary({
    id: 3,
    name: "Benito Pérez Galdós",
    sort: "Pérez Galdós, Benito",
    book_count: 2,
  }),
  aWireAuthorSummary({ id: 4, name: "[Anonymous]", sort: null, book_count: 1 }),
  aWireAuthorSummary({
    id: 7,
    name: "Zora Neale Hurston",
    sort: "Hurston, Zora Neale",
    book_count: 4,
  }),
];

// Butler was read last, so she is the author `/authors` previews.
const READING = [
  aWireAuthorReading({
    author_id: 2,
    finished: 2,
    reading: 1,
    last_read_at: 300,
  }),
  aWireAuthorReading({
    author_id: 1,
    finished: 1,
    reading: 0,
    last_read_at: 200,
  }),
];

const authorPage = getGetAuthorByIdMockHandler200(({ params }) => {
  const id = Number(params.id);
  const known = AUTHORS.find((a) => a.id === id);
  return aWireAuthor({ id, name: known?.name ?? "Unknown", book_count: 0 });
});

const authorRoutes = (
  <Routes>
    <Route path="/authors" element={<Authors />}>
      <Route index element={<AuthorsIndexPane />} />
      <Route path=":id" element={<AuthorDetail />} />
    </Route>
  </Routes>
);

const meta = {
  title: "Pages/Authors",
  component: Authors,
  parameters: { path: "/authors" },
  beforeEach({ msw }) {
    localStorage.removeItem("omnibus.discovery_prefs");
    msw.use(authorPage);
  },
  render: () => authorRoutes,
} satisfies Meta<typeof Authors>;

export default meta;
type Story = StoryObj<typeof meta>;

const withAuthors = (reading = READING) =>
  authorsHandlers({ authors: AUTHORS, reading });

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Authors 5" }),
    ).toBeInTheDocument();
    const list = canvas.getByRole("complementary", { name: "Authors" });
    const rows = await within(list).findAllByTestId("author-card");
    await expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Octavia E. Butler, 5 books, 2 finished",
      "Zora Neale Hurston, 4 books",
      "Ursula K. Le Guin, 3 books, 1 finished",
      "Benito Pérez Galdós, 2 books",
      "[Anonymous], 1 book",
    ]);
    await expect(rows[1]).toHaveTextContent("Hurston, Zora Neale");
    const rail = canvas.getByRole("navigation", { name: "Jump to letter" });
    await expect(within(rail).getByRole("link", { name: "B" })).toHaveAttribute(
      "href",
      "#letter-B",
    );
    await expect(within(rail).getByRole("link", { name: "#" })).toHaveAttribute(
      "href",
      "#letter-hash",
    );
    await expect(within(rail).queryByRole("link", { name: "Q" })).toBeNull();
    // The shown author, Butler, files under B.
    await expect(within(rail).getByRole("link", { name: "B" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await waitFor(() => expect(document.title).toBe("Omnibus | Authors"));
    await expect(
      await canvas.findByRole("heading", {
        level: 2,
        name: "Octavia E. Butler",
      }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/authors"), hanging("/api/authors/reading"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering every author"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Authors" }),
    ).toBeInTheDocument();
    await expect(canvas.queryAllByTestId("author-card")).toHaveLength(0);
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/authors", 500), ...withAuthors().slice(1));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t load authors: failed with 500",
    );
    await expect(
      canvas.getByText("Couldn’t load authors."),
    ).toBeInTheDocument();
    // No count beside the title when there is nothing to count.
    await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe(
      "Authors",
    );
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(...authorsHandlers({ authors: [] }));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(
        canvas.getAllByText("No authors yet — the library is empty."),
      ).toHaveLength(2),
    );
  },
};

export const FilteredToNone: Story = {
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", { name: "Filter authors by name" }),
      "zzz",
    );

    await expect(
      await canvas.findByText("No authors match."),
    ).toBeInTheDocument();
  },
};

export const FilterIgnoresAccents: Story = {
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", { name: "Filter authors by name" }),
      "perez galdos",
    );

    await waitFor(() =>
      expect(canvas.getAllByTestId("author-card")).toHaveLength(1),
    );
    await expect(canvas.getByTestId("author-card")).toHaveAccessibleName(
      "Benito Pérez Galdós, 2 books",
    );
  },
};

export const SortByCount: Story = {
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  play: async ({ canvas, userEvent }) => {
    const sort = within(
      await canvas.findByRole("group", { name: "Sort authors" }),
    );

    await userEvent.click(sort.getByRole("button", { name: "Most books" }));

    await expect(
      sort.getByRole("button", { name: "Most books" }),
    ).toHaveAttribute("aria-pressed", "true");
    const rows = await canvas.findAllByTestId("author-card");
    await expect(rows[0]).toHaveAccessibleName(
      "Octavia E. Butler, 5 books, 2 finished",
    );
    await expect(rows[1]).toHaveAccessibleName("Zora Neale Hurston, 4 books");
    await expect(
      canvas.queryByRole("navigation", { name: "Jump to letter" }),
    ).toBeNull();
    await expect(
      JSON.parse(localStorage.getItem("omnibus.discovery_prefs") ?? "{}"),
    ).toMatchObject({ authors_sort: "book_count" });
  },
};

export const RecentWaitsOnReading: Story = {
  beforeEach({ msw }) {
    msw.use(
      authorsHandlers({ authors: AUTHORS })[0],
      hanging("/api/authors/reading"),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const chip = await canvas.findByRole("button", { name: /Reading/ });
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveAttribute("aria-busy", "true");

    await userEvent.click(canvas.getByRole("button", { name: "Recent" }));

    await expect(
      await canvas.findByText("Gathering every author"),
    ).toBeInTheDocument();
    await expect(canvas.queryAllByTestId("author-card")).toHaveLength(0);
  },
};

export const ReadingFilter: Story = {
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  play: async ({ canvas, userEvent }) => {
    const chip = await canvas.findByRole("button", { name: "Reading 1" });
    await waitFor(() => expect(chip).toBeEnabled());

    await userEvent.click(chip);

    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(canvas.getAllByTestId("author-card")).toHaveLength(1),
    );
    await expect(canvas.getByTestId("author-card")).toHaveAccessibleName(
      "Octavia E. Butler, 5 books, 2 finished",
    );
  },
};

export const ReadingFailed: Story = {
  beforeEach({ msw }) {
    msw.use(
      authorsHandlers({ authors: AUTHORS })[0],
      failing("get", "/api/authors/reading", 500),
    );
  },
  play: async ({ canvas }) => {
    const bars = await canvas.findAllByTestId("author-row-bar");
    await waitFor(() => {
      for (const bar of bars)
        expect(bar).toHaveAttribute("data-state", "unknown");
    });
    await expect(
      canvas.getByRole("button", { name: /Reading/ }),
    ).toBeDisabled();
  },
};

export const DeepLink: Story = {
  parameters: { path: "/authors/7" },
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  play: async ({ canvas }) => {
    const row = await canvas.findByRole("link", {
      name: "Zora Neale Hurston, 4 books",
    });

    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(
      await canvas.findByRole("heading", {
        level: 2,
        name: "Zora Neale Hurston",
      }),
    ).toBeInTheDocument();
  },
};

// Forty rows, so the last one sits well below the first screen.
const MANY = Array.from({ length: 40 }, (_, n) =>
  aWireAuthorSummary({
    id: n + 1,
    name: `Author ${String(n).padStart(2, "0")}`,
    sort: `Author ${String(n).padStart(2, "0")}`,
    book_count: 1,
  }),
);

export const DeepLinkScrollsToTheRow: Story = {
  parameters: { path: "/authors/40" },
  beforeEach({ msw }) {
    msw.use(...authorsHandlers({ authors: MANY }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Author 39, 1 book" }),
    ).toHaveAttribute("aria-current", "page");

    await waitFor(() =>
      expect(canvas.getByTestId("authors-list").scrollTop).toBeGreaterThan(0),
    );
  },
};

export const SwitchingAuthorsMovesTheWindow: Story = {
  parameters: { path: "/authors/2" },
  beforeEach({ msw }) {
    msw.use(...withAuthors());
  },
  render: () => <div style={{ minHeight: "300vh" }}>{authorRoutes}</div>,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("heading", {
      level: 2,
      name: "Octavia E. Butler",
    });
    window.scrollTo(0, 400);
    await waitFor(() => expect(window.scrollY).toBe(400));

    await userEvent.click(
      await canvas.findByRole("link", { name: /^Ursula K\. Le Guin/ }),
    );
    await canvas.findByRole("heading", { level: 2, name: "Ursula K. Le Guin" });
    await waitFor(() => expect(window.scrollY).toBe(0));

    await userEvent.click(
      await canvas.findByRole("link", { name: /^Octavia E\. Butler/ }),
    );
    await canvas.findByRole("heading", { level: 2, name: "Octavia E. Butler" });
    await waitFor(() => expect(window.scrollY).toBe(400));
  },
};
