import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { anExternalBook } from "../../testing/scanHandlers";
import { aWirePalette, aWirePaletteBook } from "../../testing/wire";
import { BookSearch } from "./BookSearch";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <BookSearch
      open={open}
      onOpenChange={setOpen}
      testId="demo"
      copy={{
        button: "Find",
        name: "Find a book",
        title: "Find a book",
        hint: "Title, author or ISBN.",
      }}
      busy={false}
      error={null}
      offer={(hit) => ({
        action: {
          label: "Pick",
          busyLabel: "Picking…",
          name: `Pick ${hit.kind === "library" ? hit.book.title : hit.meta.title}`,
          run: () => {},
        },
      })}
    />
  );
}

const meta = {
  title: "Components/BookSearch",
  component: Harness,
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/search/palette", () =>
        HttpResponse.json(
          aWirePalette({
            books: [
              aWirePaletteBook({
                uuid: "uuid-dune",
                title: "Dune",
                formats: ["EPUB"],
              }),
            ],
          }),
        ),
      ),
      http.post("/api/scan/search", () =>
        HttpResponse.json({
          results: [
            anExternalBook({ title: "Dune (Ace)", authors: ["Frank Herbert"] }),
          ],
        }),
      ),
    );
  },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensAndListsTheLibraryThenTheProviders: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("demo"));
    const panel = within(await canvas.findByTestId("demo-panel"));

    await userEvent.type(panel.getByTestId("demo-search"), "dune");

    const library = within(await panel.findByTestId("demo-library"));
    await expect(await library.findAllByText("Dune")).not.toHaveLength(0);
    const online = within(await panel.findByTestId("demo-online"));
    await expect(await online.findAllByText("Dune (Ace)")).not.toHaveLength(0);
  },
};
