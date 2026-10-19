import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect } from "storybook/test";
import { getGetEbookByUuidMockHandler404 } from "../../api/generated/omnibus.msw";
import { bookHandler, failing } from "../../testing/handlers";
import { aWireBook } from "../../testing/wire";
import { BookDetail } from "./BookDetail";

const BOOK = aWireBook({
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
    msw.use(bookHandler(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("Aurora Station · Book 1 · 2021"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("First contact")).toBeInTheDocument();

    const toggle = canvas.getByRole("button", { name: "Show more" });
    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
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
