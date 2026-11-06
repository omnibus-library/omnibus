import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { recentProgressHandler } from "../../testing/handlers";
import { WIRE_ADA } from "../../testing/wire";
import { TopNav } from "./TopNav";

const meta = {
  title: "Components/TopNav",
  component: TopNav,
} satisfies Meta<typeof TopNav>;

export default meta;
type Story = StoryObj<typeof meta>;

function Where() {
  const { pathname, state } = useLocation();
  return (
    <output data-testid="where">
      {pathname} {JSON.stringify(state)}
    </output>
  );
}

const withWhere = () => (
  <>
    <TopNav />
    <Where />
  </>
);

const openAddMenu = async (
  canvas: { getByRole: (r: string, o: { name: string }) => HTMLElement },
  userEvent: { click: (e: Element) => Promise<void> },
) => {
  await userEvent.click(canvas.getByRole("button", { name: "Add" }));
  return canvas.getByRole("menu", { name: "Add" });
};

export const SignedIn: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Open user menu" }),
    ).toHaveTextContent("AL");
    await expect(canvas.getByRole("button", { name: "Add" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      canvas.queryByRole("link", { name: "Check in" }),
    ).not.toBeInTheDocument();
  },
};

/** The menu's items in order, found by their exact names: a description must not join the name. */
const itemsNamed = (menu: HTMLElement, names: string[]) =>
  names.map((name) => within(menu).getByRole("menuitem", { name }));

export const AddMenuOffersThreeWaysToAdd: Story = {
  play: async ({ canvas, userEvent }) => {
    const menu = await openAddMenu(canvas, userEvent);

    const items = itemsNamed(menu, [
      "Upload book files",
      "Add a copy you own",
      "Add to your wishlist",
    ]);
    await expect(within(menu).getAllByRole("menuitem")).toEqual(items);
    await expect(items[0]).toHaveAccessibleDescription(
      "EPUB, PDF, CBZ, M4B or MP3 from this computer",
    );
    await expect(items[1]).toHaveAccessibleDescription(
      "Scan or type the ISBN of a print book",
    );
    await expect(items[2]).toHaveAccessibleDescription(
      "A book you’d like the household to find",
    );
    await expect(canvas.getByRole("button", { name: "Add" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  },
};

export const AddMenuCarriesThePopoverShadow: Story = {
  beforeEach({ msw }) {
    msw.use(recentProgressHandler([]));
  },
  play: async ({ canvas, userEvent }) => {
    const shadow = getComputedStyle(
      await openAddMenu(canvas, userEvent),
    ).boxShadow;
    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(shadow).toBe(
      getComputedStyle(canvas.getByRole("dialog", { name: "User menu" }))
        .boxShadow,
    );
  },
};

export const AddMenuMovesByArrowsAndClosesOnEscape: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Add" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const menu = canvas.getByRole("menu", { name: "Add" });
    await expect(
      within(menu).getByRole("menuitem", { name: "Upload book files" }),
    ).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    await expect(
      within(menu).getByRole("menuitem", { name: "Add a copy you own" }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    await expect(
      within(menu).getByRole("menuitem", { name: "Add to your wishlist" }),
    ).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};

export const UploadBookFilesOpensTheAddBookSheet: Story = {
  play: async ({ canvas, userEvent }) => {
    const menu = await openAddMenu(canvas, userEvent);
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Upload book files" }),
    );

    await expect(
      await canvas.findByRole("dialog", { name: "Add a book" }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(canvas.queryByRole("dialog", { name: "Add a book" })).toBeNull(),
    );
  },
};

export const AddACopyYouOwnOpensCheckIn: Story = {
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    const menu = await openAddMenu(canvas, userEvent);
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Add a copy you own" }),
    );

    await expect(canvas.getByTestId("where")).toHaveTextContent(
      '/check-in {"fromApp":true}',
    );
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
  },
};

export const AddToYourWishlistOpensTheWishlistSearch: Story = {
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    const menu = await openAddMenu(canvas, userEvent);
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Add to your wishlist" }),
    );

    await expect(canvas.getByTestId("where")).toHaveTextContent(
      '/wishlists {"add":true}',
    );
  },
};

export const WithoutUploadAccess: Story = {
  parameters: { user: { ...WIRE_ADA, can_upload: false } },
  play: async ({ canvas, userEvent }) => {
    const menu = await openAddMenu(canvas, userEvent);

    await expect(within(menu).getAllByRole("menuitem")).toEqual(
      itemsNamed(menu, ["Add a copy you own", "Add to your wishlist"]),
    );
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

export const AddMenuFitsAPhone: Story = {
  ...windowOf(390),
  play: async ({ canvas, userEvent }) => {
    await document.fonts.ready;
    const menu = await openAddMenu(canvas, userEvent);

    const { left, right } = menu.getBoundingClientRect();
    await expect(left).toBeGreaterThanOrEqual(0);
    await expect(right).toBeLessThanOrEqual(window.innerWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  },
};
