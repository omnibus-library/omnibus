import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetAuthorByIdMockHandler200,
  getGetAuthorByIdMockHandler404,
} from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import {
  authorPhotoHandlers,
  authorsHandlers,
  failing,
  hanging,
  svg,
} from "../../testing/handlers";
import {
  aWireAuthor,
  aWireAuthorReading,
  aWireAuthorSummary,
  aWireBook,
  aWireBookReading,
  uuidOf,
  WIRE_ADA,
} from "../../testing/wire";
import { Authors, AuthorsIndexPane } from "../Authors/Authors";
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
    await waitFor(() =>
      expect(document.title).toBe("Omnibus | Ursula K. Le Guin"),
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

const deleted: string[] = [];
const reads: string[] = [];
const reloads: string[] = [];

// The admin stories run inside the authors list, which is what a delete has to update.
const OTHER = aWireAuthor({ id: 3, name: "Octavia E. Butler", book_count: 0 });

const inTheList = {
  parameters: { path: "/authors/2" },
  render: () => (
    <Routes>
      <Route path="/authors" element={<Authors />}>
        <Route index element={<AuthorsIndexPane />} />
        <Route path=":id" element={<AuthorDetail />} />
      </Route>
    </Routes>
  ),
} satisfies Story;

function listHandlers() {
  deleted.length = 0;
  reads.length = 0;
  return [
    ...authorsHandlers({
      authors: [
        aWireAuthorSummary({
          id: 2,
          name: "Ursula K. Le Guin",
          sort: "Le Guin, Ursula K.",
        }),
        aWireAuthorSummary({
          id: 3,
          name: "Octavia E. Butler",
          sort: "Butler, Octavia E.",
        }),
      ],
      reading: [aWireAuthorReading({ author_id: 3, last_read_at: 500 })],
    }),
    getGetAuthorByIdMockHandler200(({ params }) => {
      reads.push(String(params.id));
      return params.id === "2" ? AUTHOR : OTHER;
    }),
    http.delete("/api/authors/:id", ({ params }) => {
      deleted.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

export const NonAdmin: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { level: 2, name: "Ursula K. Le Guin" });

    await expect(
      canvas.queryByRole("button", {
        name: "More actions for Ursula K. Le Guin",
      }),
    ).toBeNull();
    // Dioxus shows the photo overlay to every viewer; the server refuses a non-admin's edit.
    await expect(
      canvas.getByRole("button", { name: "Edit photo for Ursula K. Le Guin" }),
    ).toBeInTheDocument();
  },
};

export const OpensTheDeleteDialog: Story = {
  play: async ({ canvas, userEvent }) => {
    const more = await canvas.findByRole("button", {
      name: "More actions for Ursula K. Le Guin",
    });
    await expect(more).toHaveAttribute("aria-haspopup", "menu");
    await expect(more).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more);

    await expect(more).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete author…" }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: "Delete Ursula K. Le Guin",
    });
    await expect(within(dialog).getByRole("heading")).toHaveTextContent(
      'Delete "Ursula K. Le Guin"?',
    );
    await expect(dialog).toHaveTextContent(
      "This will un-link the author from 5 books and prevent the name from being re-added on future library scans. The books themselves are not deleted.",
    );
    await expect(canvas.queryByRole("menu")).toBeNull();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await expect(canvas.queryByRole("dialog")).toBeNull();
  },
};

export const DeleteSuccess: Story = {
  ...inTheList,
  beforeEach({ msw }) {
    msw.use(...listHandlers());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "More actions for Ursula K. Le Guin",
      }),
    );
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete author…" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete" }),
    );

    await waitFor(() => expect(deleted).toEqual(["2"]));
    await expect(
      await canvas.findByRole("heading", {
        level: 2,
        name: "Octavia E. Butler",
      }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(
      canvas.queryByRole("link", { name: /^Ursula K. Le Guin/ }),
    ).toBeNull();
    await expect(
      canvas.getByRole("link", { name: /^Octavia E. Butler/ }),
    ).toBeInTheDocument();
    // The deleted author is dropped from the cache, not fetched again as a 404.
    await expect(reads).toEqual(["2", "3"]);
  },
};

export const DeletePreviewedAuthor: Story = {
  ...inTheList,
  parameters: { path: "/authors" },
  beforeEach({ msw }) {
    msw.use(
      // The author left in Butler's place stays loading, as the pane would sit on the deleted page.
      http.get("/api/authors/:id", async ({ params }) => {
        if (params.id === "2") await delay("infinite");
        return HttpResponse.json(OTHER);
      }),
      ...listHandlers(),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "More actions for Octavia E. Butler",
      }),
    );
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete author…" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete" }),
    );

    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await expect(deleted).toEqual(["3"]);
    // The pane must not keep showing the deleted author while the next one loads.
    await expect(
      canvas.queryByRole("heading", { level: 2, name: "Octavia E. Butler" }),
    ).toBeNull();
  },
};

export const DeleteFailing: Story = {
  ...inTheList,
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/authors/:id", 403), ...listHandlers());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "More actions for Ursula K. Le Guin",
      }),
    );
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete author…" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "⚠ failed with 403",
    );
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: /^Ursula K. Le Guin/ }),
    ).toBeInTheDocument();
  },
};

export const DeleteWorkingIgnoresDismissal: Story = {
  ...inTheList,
  beforeEach({ msw }) {
    msw.use(hanging("/api/authors/:id", "delete"), ...listHandlers());
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "More actions for Ursula K. Le Guin",
      }),
    );
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete author…" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete" }),
    );

    await expect(
      await canvas.findByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("dialog"));
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const NewPhotoRefetchesTheAuthor: Story = {
  beforeEach({ msw }) {
    reads.length = 0;
    reloads.length = 0;
    msw.use(
      http.get("/api/authors/:id/photo", ({ request }) => {
        // Only the cache-replacing fetch asks for `reload`, not the <img> loads.
        if (request.cache === "reload") reloads.push("photo");
        return svg();
      }),
      getGetAuthorByIdMockHandler200(() => {
        reads.push("author");
        return AUTHOR;
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Edit photo for Ursula K. Le Guin",
      }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Scan for picture" }),
    );

    await waitFor(() => expect(reads).toHaveLength(2));
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(reloads).toEqual(["photo"]));
    // The same URL under a new query, so the browser's day-long cache is skipped.
    await expect(
      await canvas.findByRole("img", { name: "Ursula K. Le Guin" }),
    ).toHaveAttribute("src", "/api/authors/2/photo?v=1");
  },
};
