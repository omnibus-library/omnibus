import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { WIRE_ADA } from "../../testing/wire";
import { TopNav } from "./TopNav";

const meta = {
  title: "Components/TopNav",
  component: TopNav,
} satisfies Meta<typeof TopNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Open user menu" }),
    ).toHaveTextContent("AL");
    await expect(
      canvas.getByRole("button", { name: "Add books" }),
    ).toBeInTheDocument();
  },
};

export const AddBooksOpensTheAddBookSheet: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add books" }));

    await expect(
      await canvas.findByRole("dialog", { name: "Add a book" }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(canvas.queryByRole("dialog", { name: "Add a book" })).toBeNull(),
    );
  },
};

export const WithoutUploadAccess: Story = {
  parameters: { user: { ...WIRE_ADA, can_upload: false } },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: "Add books" }),
    ).not.toBeInTheDocument();
  },
};

export const InASection: Story = {
  parameters: { path: "/authors/12" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Authors" })).toHaveClass(
      "on",
    );
    await expect(canvas.getByRole("link", { name: "Library" })).not.toHaveClass(
      "on",
    );
    await expect(canvas.getByRole("link", { name: "Shelves" })).not.toHaveClass(
      "on",
    );
  },
};

export const OnAShelf: Story = {
  parameters: { path: "/shelves/9" },
  play: async ({ canvas }) => {
    const shelves = canvas.getByRole("link", { name: "Shelves" });
    await expect(shelves).toHaveClass("on");
    await expect(shelves).toHaveAttribute("href", "/shelves");
    await expect(canvas.getByRole("link", { name: "Library" })).not.toHaveClass(
      "on",
    );
  },
};

/** The bar's height must be the one `--topbar-h` says, since full-screen overlays begin beneath it. */
const heightMatchesToken = async (canvas: {
  getByRole: (r: string, o: { name: string }) => HTMLElement;
}) => {
  const bar = canvas.getByRole("navigation", { name: "Primary" });
  await waitFor(() => {
    const token = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"),
    );
    expect(bar.getBoundingClientRect().height).toBe(token);
  });
};

export const BarIsAsTallAsTheTopbarToken: Story = {
  play: async ({ canvas }) => heightMatchesToken(canvas),
};

const windowOf = (width: number) => ({
  globals: { viewport: { value: "window", isRotated: false } },
  parameters: {
    viewport: {
      options: {
        window: {
          name: "Window",
          styles: { width: `${width}px`, height: "844px" },
        },
      },
    },
  },
});

export const BarIsAsTallAsTheTopbarTokenOnAPhone: Story = {
  ...windowOf(390),
  play: async ({ canvas }) => heightMatchesToken(canvas),
};

// The decorator pads 24px a side, so a 769px window gives the bar 721px and 1009px gives 961px.
const fitsAWindowOf = (width: number): Story => ({
  ...windowOf(width),
  play: async ({ canvas }) => {
    await document.fonts.ready;
    await expect(canvas.getByRole("link", { name: "Shelves" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Search" })).toBeVisible();
    const bar = canvas.getByRole("navigation", { name: "Primary" });
    await waitFor(() =>
      expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth),
    );
  },
});

export const FitsAWindowJustAboveThePhoneBreakpoint = fitsAWindowOf(769);

export const FitsAWindowJustAboveTheSearchCollapse = fitsAWindowOf(1009);
