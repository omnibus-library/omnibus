import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, waitFor } from "storybook/test";
import { getGetEbookByUuidMockHandler404 } from "../../api/generated/omnibus.msw";
import type { MetadataOverrides } from "../../api/generated/schemas";
import {
  bookHandler,
  failing,
  filterOptionHandlers,
  hanging,
} from "../../testing/handlers";
import {
  anEditableWireBook,
  overridesHandlers,
} from "../../testing/metadataHandlers";
import { BookEdit } from "./BookEdit";

const BOOK = anEditableWireBook();
const OVERRIDDEN = anEditableWireBook({ has_override: true });
const UUID = BOOK.unique_identifier;

const saved: MetadataOverrides[] = [];
const reverted = { count: 0 };

// The page reads its uuid from the route, leaves for the book's page, and its
// leave guard needs a data router, which the stories' own harness doesn't provide.
function EditRoutes() {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        { path: "/", element: <p>Library</p> },
        { path: "/books/:uuid/edit", element: <BookEdit /> },
        { path: "/books/:uuid", element: <p>Book page</p> },
      ],
      { initialEntries: [`/books/${UUID}/edit`] },
    ),
  );
  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/BookEdit",
  component: EditRoutes,
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    saved.length = 0;
    reverted.count = 0;
    msw.use(
      bookHandler(BOOK),
      ...overridesHandlers(BOOK, { saved, reverted }),
      ...filterOptionHandlers(),
    );
  },
} satisfies Meta<typeof EditRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Opening the record"),
    ).toBeInTheDocument();
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
    await expect(
      canvas.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to book" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  },
};

export const Loaded: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: /Aurora Station, Vol. 1/ }),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue(
      "Aurora Station, Vol. 1",
    );
    await expect(canvas.getByLabelText(/^Sort by/)).toHaveValue(
      "Inkwell, Sora",
    );
    await expect(canvas.getByLabelText(/^Print Pages/)).toHaveValue("320");
    await expect(canvas.getByText("space opera")).toBeInTheDocument();
    await expect(canvas.getByText("No changes")).toBeInTheDocument();
    await expect(canvas.getByTestId("me-save")).toBeDisabled();
    await expect(canvas.getByTestId("me-save")).toHaveTextContent("Done");
    await expect(canvas.getByTestId("me-crumb-author")).toHaveAttribute(
      "href",
      "/authors/2",
    );
    await expect(canvas.getByText("Identifiers")).toBeInTheDocument();
    await expect(canvas.queryByText("Override active")).not.toBeInTheDocument();
  },
};

export const SavesTitle: Story = {
  play: async ({ canvas, userEvent }) => {
    const title = await canvas.findByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, "Aurora Station");

    await expect(canvas.getByText("1 field edited")).toBeInTheDocument();
    await expect(canvas.getByText("· EDITED")).toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Save · 1 field" }),
    );

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(saved).toEqual([{ title: "Aurora Station" }]);
  },
};

export const SaveFails: Story = {
  beforeEach({ msw }) {
    msw.use(...overridesHandlers(BOOK, { refuse: "title is too long" }));
  },
  play: async ({ canvas, userEvent }) => {
    const title = await canvas.findByLabelText(/^Title/);
    await userEvent.type(title, "!");
    await userEvent.click(canvas.getByTestId("me-save"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "title is too long",
    );
    await expect(title).toHaveValue("Aurora Station, Vol. 1!");
  },
};

export const Reverts: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(OVERRIDDEN));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText("Override active"),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("revert-overrides"));

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(reverted.count).toBe(1);
  },
};

export const RevertFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      bookHandler(OVERRIDDEN),
      ...overridesHandlers(OVERRIDDEN, { refuse: "not allowed" }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("revert-overrides"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "not allowed",
    );
    await expect(canvas.getByTestId("revert-overrides")).toBeEnabled();
  },
};

export const DiscardsWithoutSaving: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText(/^Title/), "!");
    await userEvent.click(canvas.getByRole("link", { name: "Discard edits" }));

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(saved).toEqual([]);
  },
};

export const AddsTag: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Tags"), "cozy{Enter}");

    await expect(canvas.getByText("cozy")).toBeInTheDocument();
    await expect(canvas.getByText("1 field edited")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("me-save"));

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(saved).toEqual([{ subjects: ["space opera", "cozy"] }]);
  },
};

export const PrintPagesNotANumber: Story = {
  play: async ({ canvas, userEvent }) => {
    const pages = await canvas.findByLabelText(/^Print Pages/);
    await userEvent.clear(pages);
    await userEvent.type(pages, "abc");
    await userEvent.click(canvas.getByTestId("me-save"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Print page count must be a whole number.",
    );
    await expect(saved).toEqual([]);
  },
};

export const AsksBeforeLeavingWithEdits: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText(/^Title/), "!");
    await expect(window.onbeforeunload).not.toBeNull();
    await userEvent.click(canvas.getByRole("link", { name: "Home" }));

    await expect(
      await canvas.findByRole("dialog", { name: "Discard unsaved changes" }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Keep editing" }));

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue(
      "Aurora Station, Vol. 1!",
    );
  },
};

export const DiscardsEditsFromTheDialog: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText(/^Title/), "!");
    await userEvent.click(canvas.getByRole("link", { name: "Home" }));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Discard" }),
    );

    await expect(await canvas.findByText("Library")).toBeInTheDocument();
    await expect(saved).toEqual([]);
    await waitFor(() => expect(window.onbeforeunload).toBeNull());
  },
};

export const LeavesCleanWithoutAsking: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("link", { name: "Home" }));

    await expect(await canvas.findByText("Library")).toBeInTheDocument();
  },
};
