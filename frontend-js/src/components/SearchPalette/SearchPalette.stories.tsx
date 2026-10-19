import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocation } from "react-router";
import { expect } from "storybook/test";
import { failing, hanging, paletteHandler } from "../../testing/handlers";
import { aWirePalette } from "../../testing/wire";
import {
  SearchPaletteOverlay,
  SearchPaletteProvider,
  SearchPaletteTrigger,
} from "./SearchPalette";

// Prints where the router is, so a story can assert where a row led.
function Location() {
  const { pathname } = useLocation();
  return <output aria-label="Location">{pathname}</output>;
}

function Palette() {
  return (
    <SearchPaletteProvider>
      <SearchPaletteTrigger />
      <SearchPaletteOverlay />
      <Location />
    </SearchPaletteProvider>
  );
}

const meta = {
  title: "Components/SearchPalette",
  component: Palette,
  beforeEach({ msw }) {
    msw.use(paletteHandler(aWirePalette()));
  },
} satisfies Meta<typeof Palette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensFromTrigger: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));

    await expect(
      canvas.getByRole("dialog", { name: "Search palette" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByPlaceholderText(
        "Search books, authors, series, tags, settings…",
      ),
    ).toHaveFocus();
  },
};

export const OpensWithShortcut: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.keyboard("{Control>}k{/Control}");

    await expect(
      canvas.getByRole("dialog", { name: "Search palette" }),
    ).toBeInTheDocument();
  },
};

export const ResultCount: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));

    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search" }),
      "aurora",
    );

    await expect(
      await canvas.findByText("5 results · 18ms"),
    ).toBeInTheDocument();
  },
};

export const OpensBookRow: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search" }),
      "aurora",
    );

    await userEvent.click(
      await canvas.findByRole("link", { name: /Aurora Station, Vol\. 1/ }),
    );

    await expect(
      canvas.getByRole("status", { name: "Location" }),
    ).toHaveTextContent("/books/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
    await expect(
      canvas.queryByRole("dialog", { name: "Search palette" }),
    ).not.toBeInTheDocument();
  },
};

export const EnterOpensHighlightedRow: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search" }),
      "aurora",
    );
    await canvas.findByText("5 results · 18ms");

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await expect(
      canvas.getByRole("status", { name: "Location" }),
    ).toHaveTextContent("/authors/2");
  },
};

export const EnterSearchesWithoutHighlight: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));

    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search" }),
      " dune messiah {Enter}",
    );

    await expect(
      canvas.getByRole("status", { name: "Location" }),
    ).toHaveTextContent("/search/dune%20messiah");
  },
};

export const EscapeCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));

    await userEvent.keyboard("{Escape}");

    await expect(
      canvas.queryByRole("dialog", { name: "Search palette" }),
    ).not.toBeInTheDocument();
  },
};

export const SearchFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/search/palette", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search" }),
      "aurora",
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t run that search. Check your connection and try again.",
    );
  },
};

export const SettingsBeforeServer: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/search/palette"));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search" }),
      "kindle",
    );

    await expect(
      canvas.getByRole("link", { name: /Send to Kindle/ }),
    ).toHaveAttribute("href", "/settings?section=devices");
    await expect(await canvas.findByText("Searching")).toBeInTheDocument();
  },
};

export const OutsideClickCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Search/ }));

    await userEvent.click(canvas.getByTestId("sp-scrim"));

    await expect(
      canvas.queryByRole("dialog", { name: "Search palette" }),
    ).not.toBeInTheDocument();
  },
};
