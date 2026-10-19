import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetAuthorByIdMockHandler200,
  getGetAuthorByIdMockHandler404,
} from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import { authorPhotoHandlers, failing, hanging } from "../../testing/handlers";
import {
  aWireAuthor,
  aWireBook,
  aWireBookReading,
  uuidOf,
} from "../../testing/wire";
import { AuthorDetail } from "./AuthorDetail";

const DAY = 86_400;

const book = (n: number, title: string, series?: [string, string]) =>
  aWireBook({
    id: n,
    title,
    unique_identifier: uuidOf(n),
    cover_url: `/api/covers/${uuidOf(n)}`,
    formats: ["EPUB"],
    series: series?.[0] ?? null,
    series_index: series?.[1] ?? null,
    series_id: series ? (series[0] === "Earthsea" ? 7 : 8) : null,
  });

const BOOKS = [
  book(1, "A Wizard of Earthsea", ["Earthsea", "1"]),
  book(2, "The Tombs of Atuan", ["Earthsea", "2"]),
  book(3, "The Farthest Shore", ["Earthsea", "3"]),
  book(4, "The Left Hand of Darkness", ["Hainish", "1"]),
  book(5, "The Lathe of Heaven"),
];

const AUTHOR = aWireAuthor({
  id: 2,
  name: "Ursula K. Le Guin",
  book_count: 5,
  has_photo: true,
  books: BOOKS,
  reading: [
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
  ],
});

function LocationProbe() {
  const { pathname, state } = useLocation();
  return <p data-testid="location">{`${pathname} ${JSON.stringify(state)}`}</p>;
}

const meta = {
  title: "Pages/AuthorDetail",
  component: AuthorDetail,
  parameters: { path: "/authors/2" },
  beforeEach({ msw }) {
    localStorage.removeItem("omnibus.landing_shelf");
    msw.use(...authorPhotoHandlers(), getGetAuthorByIdMockHandler200(AUTHOR));
  },
  render: () => (
    <Routes>
      <Route path="/authors/:id" element={<AuthorDetail />} />
      <Route path="/authors" element={<p>The authors</p>} />
      <Route path="/" element={<LocationProbe />} />
    </Routes>
  ),
} satisfies Meta<typeof AuthorDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 2,
        name: "Ursula K. Le Guin",
      }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("author-meta")).toHaveTextContent(
      "5 books · 2 series",
    );
    await expect(
      await canvas.findByRole("img", { name: "Ursula K. Le Guin" }),
    ).toHaveAttribute("src", "/api/authors/2/photo");
    await expect(
      canvas.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Earthsea", "Hainish", "Other works"]);
    const earthsea = canvas.getByRole("heading", { name: "Earthsea" })
      .parentElement as HTMLElement;
    await expect(earthsea).toHaveTextContent("3 books · 1 finished");
    await expect(
      within(earthsea).getByRole("link", { name: "Earthsea series page" }),
    ).toHaveAttribute("href", "/series/7");
    await expect(
      canvas.getByRole("link", {
        name: "Open details for The Lathe of Heaven",
      }),
    ).toHaveAttribute("href", `/books/${uuidOf(5)}`);
    await expect(
      canvas.getByRole("button", { name: "Show in library" }),
    ).toBeInTheDocument();
  },
};

export const Reading: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("img", { name: "1 of 5 finished, 1 reading" }),
    ).toBeInTheDocument();
    const tally = canvas.getByText("finished").parentElement?.parentElement;
    await expect(tally).toHaveTextContent("1 finished");
    await expect(tally).toHaveTextContent("1 reading");
    await expect(tally).toHaveTextContent("3 unread");
    const current = within(canvas.getByTestId("author-current"));
    await expect(
      current.getByRole("link", { name: "The Tombs of Atuan" }),
    ).toHaveAttribute("href", `/books/${uuidOf(2)}`);
    await expect(
      canvas.getByText("Earthsea 2 · 42% · read 3 days ago"),
    ).toBeInTheDocument();
    await expect(current.getByRole("link", { name: "Resume" })).toHaveAttribute(
      "href",
      `/read/${uuidOf(2)}`,
    );
  },
};

export const NoBooks: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({ id: 2, name: "Ursula K. Le Guin", book_count: 0 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("author-meta")).toHaveTextContent(
      "0 books",
    );
    await expect(canvas.queryByTestId("author-reading")).toBeNull();
    await expect(canvas.queryByRole("heading", { level: 3 })).toBeNull();
  },
};

export const PhotoBroken: Story = {
  // Another id than the stories above, whose photo the browser has cached.
  parameters: { path: "/authors/9" },
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200({ ...AUTHOR, id: 9 }),
      failing("get", "/api/authors/:id/photo", 404),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { level: 2, name: "Ursula K. Le Guin" });
    await waitFor(() =>
      expect(
        canvas.queryByRole("img", { name: "Ursula K. Le Guin" }),
      ).toBeNull(),
    );
    await expect(canvasElement.querySelector(".au-avatar")).toHaveTextContent(
      "U",
    );
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetAuthorByIdMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Author not found."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to authors" }),
    ).toHaveAttribute("href", "/authors");
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/authors/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to authors" }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/authors/:id"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Finding the author"),
    ).toBeInTheDocument();
  },
};

export const ShowInLibrary: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show in library" }),
    );

    await expect(await canvas.findByTestId("location")).toHaveTextContent(
      '/ {"clauses":[{"field":"author","mode":"include","values":["Ursula K. Le Guin"]}]}',
    );
    await expect(
      JSON.parse(localStorage.getItem("omnibus.landing_shelf") ?? "null"),
    ).toEqual({ kind: "all" });
  },
};
