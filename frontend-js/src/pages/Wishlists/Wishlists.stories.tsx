import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { deferred, failing, hanging } from "../../testing/handlers";
import { BOOKS } from "../../testing/wishlistHandlers";
import {
  api,
  BANNED_COPY,
  fake,
  Page,
  PHONE,
} from "./Wishlists.stories.shared";

const meta = {
  title: "Pages/Wishlists",
  component: Page,
  parameters: { path: "/wishlists" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

/** The rows on screen, by title. */
const titles = async (canvas: Canvas) =>
  (await canvas.findAllByTestId("wishlists-row")).map(
    (row: HTMLElement) =>
      within(row).getByTestId("wishlists-title").textContent,
  );

const rowOf = async (canvas: Canvas, title: string) => {
  const rows = await canvas.findAllByTestId("wishlists-row");
  const row = rows.find((r: HTMLElement) =>
    within(r).queryByRole("link", { name: title }),
  );
  if (!row) throw new Error(`no row for ${title}`);
  return row;
};

export const ShowsYourListNewestFirst: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Your Wishlist");
    await expect(canvas.getByText("4 books")).toBeInTheDocument();
    await expect(await titles(canvas)).toEqual([
      "Hyperion",
      "All Systems Red",
      "Project Hail Mary",
      "Red Rising",
    ]);
    await expect(fake.requests).toEqual([null]);
  },
};

export const RowsShowHoldingsBylineAndAddedDay: Story = {
  play: async ({ canvas }) => {
    const hyperion = await rowOf(canvas, "Hyperion");
    await expect(
      within(hyperion).getByText("Dan Simmons · Hyperion Cantos · 1"),
    ).toBeInTheDocument();
    await expect(within(hyperion).getByText("—")).toBeInTheDocument();
    await expect(within(hyperion).getByText("Oct 30")).toBeInTheDocument();

    const redRising = await rowOf(canvas, "Red Rising");
    await expect(
      within(redRising).getByRole("list", { name: "In the library" }),
    ).toHaveTextContent("EPUB×3M4B×2PRINT");

    const hailMary = await rowOf(canvas, "Project Hail Mary");
    await expect(
      within(hailMary).getByRole("list", { name: "In the library" }),
    ).toHaveTextContent("EPUB×2");
    await expect(within(hailMary).getByText("Andy Weir")).toBeInTheDocument();
  },
};

export const BookWithoutACoverShowsItsPlate: Story = {
  play: async ({ canvas }) => {
    const hyperion = await rowOf(canvas, "Hyperion");
    await expect(hyperion.querySelector("img")).toBeNull();
    await expect(
      within(hyperion).getAllByText("Hyperion").length,
    ).toBeGreaterThan(1);
    const redRising = await rowOf(canvas, "Red Rising");
    await expect(redRising.querySelector("img")).toHaveAttribute(
      "src",
      `/api/thumbs/${BOOKS.redRising.uuid}/md`,
    );
  },
};

export const TitleLinksToTheBookPage: Story = {
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "Hyperion");

    await userEvent.click(within(row).getByRole("link", { name: "Hyperion" }));

    await expect(await canvas.findByTestId("where")).toHaveTextContent(
      `/books/${BOOKS.hyperion.uuid}`,
    );
  },
};

export const EveryoneShowsOneRowPerBookWithNames: Story = {
  parameters: { path: "/wishlists?user=all" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Everyone’s Wishlists");
    await expect(
      canvas.getByText("8 books across 3 wishlists"),
    ).toBeInTheDocument();
    const rows = await canvas.findAllByTestId("wishlists-row");
    await expect(rows).toHaveLength(8);
    await expect(fake.requests).toEqual(["all"]);

    await expect(
      within(await rowOf(canvas, "Project Hail Mary")).getByText("Jordan, you"),
    ).toBeInTheDocument();
    await expect(
      within(await rowOf(canvas, "Piranesi")).getByText("Jordan, Riley"),
    ).toBeInTheDocument();
    await expect(
      within(await rowOf(canvas, "Hyperion")).getByText("You"),
    ).toBeInTheDocument();
    await expect(
      within(await rowOf(canvas, "Dune")).getByText("Riley"),
    ).toBeInTheDocument();
  },
};

export const AnotherReaderShowsTheirList: Story = {
  parameters: { path: "/wishlists?user=2" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Jordan’s Wishlist");
    await expect(canvas.getByText("5 books")).toBeInTheDocument();
    await expect(await titles(canvas)).toEqual([
      "Project Hail Mary",
      "Piranesi",
      "Babel",
      "Children of Time",
      "Red Rising",
    ]);
    await expect(fake.requests).toEqual(["2"]);
  },
};

export const YourOwnIdShowsYourList: Story = {
  parameters: { path: "/wishlists?user=1" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Your Wishlist");
    await expect(fake.requests).toEqual([null]);
  },
};

export const JunkUserFallsBackToYourList: Story = {
  parameters: { path: "/wishlists?user=abc" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Your Wishlist");
    await expect(fake.requests).toEqual([null]);
  },
};

export const PanelListsEveryoneThenEachReaderWithCounts: Story = {
  parameters: { path: "/wishlists?user=2" },
  play: async ({ canvas }) => {
    const panel = within(await canvas.findByTestId("wishlists-panel"));
    await waitFor(() =>
      expect(panel.getByTestId("wishlists-reader-everyone")).toHaveTextContent(
        "Everyone8",
      ),
    );
    await expect(panel.getByTestId("wishlists-reader-you")).toHaveTextContent(
      "You4",
    );
    await expect(panel.getByTestId("wishlists-reader-2")).toHaveTextContent(
      "Jordan5",
    );
    await expect(panel.getByTestId("wishlists-reader-4")).toHaveTextContent(
      "Sam0",
    );
    await expect(
      panel.getByTestId("wishlists-reader-everyone"),
    ).toHaveAttribute("href", "/wishlists?user=all");
    await expect(panel.getByTestId("wishlists-reader-you")).toHaveAttribute(
      "href",
      "/wishlists",
    );
    await expect(panel.getByTestId("wishlists-reader-3")).toHaveAttribute(
      "href",
      "/wishlists?user=3",
    );
    await expect(panel.getByTestId("wishlists-reader-2")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(panel.getByTestId("wishlists-reader-you")).not.toHaveAttribute(
      "aria-current",
    );
  },
};

export const SwitchingReadersFromThePanelChangesTheList: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = within(await canvas.findByTestId("wishlists-panel"));
    await canvas.findAllByTestId("wishlists-row");

    await userEvent.click(await panel.findByTestId("wishlists-reader-3"));

    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Riley’s Wishlist");
    await waitFor(async () =>
      expect(await titles(canvas)).toEqual(["Piranesi", "Dune"]),
    );
    await expect(panel.getByTestId("wishlists-reader-3")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

let held = deferred();

export const KeepsThePreviousListDimmedWhileTheNextLoads: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(...api({ gate: { user: "3", until: held.promise } }));
  },
  play: async ({ canvas, userEvent }) => {
    const panel = within(await canvas.findByTestId("wishlists-panel"));
    await canvas.findAllByTestId("wishlists-row");

    await userEvent.click(await panel.findByTestId("wishlists-reader-3"));

    await waitFor(() =>
      expect(
        canvas
          .getByTestId("wishlists-page")
          .querySelector("[aria-busy='true']"),
      ).not.toBeNull(),
    );
    await expect(await titles(canvas)).toContain("Hyperion");
    await expect(
      canvas.queryByTestId("wishlists-empty"),
    ).not.toBeInTheDocument();
    held.release();
    await waitFor(async () =>
      expect(await titles(canvas)).toEqual(["Piranesi", "Dune"]),
    );
  },
};

export const PhonePickerOpensChoosesAndCloses: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByTestId("wishlists-picker-trigger");
    await waitFor(() => expect(trigger).toBeEnabled());
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByTestId("wishlists-panel")).not.toBeVisible();

    await userEvent.click(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = within(await canvas.findByTestId("wishlists-picker-menu"));
    await expect(
      menu.getByTestId("wishlists-reader-everyone"),
    ).toHaveTextContent("Everyone8");
    await userEvent.click(menu.getByTestId("wishlists-reader-2"));

    await expect(
      canvas.queryByTestId("wishlists-picker-menu"),
    ).not.toBeInTheDocument();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Jordan’s Wishlist");
  },
};

export const PhonePickerClosesOnEscape: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByTestId("wishlists-picker-trigger");
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    await canvas.findByTestId("wishlists-picker-menu");

    await userEvent.keyboard("{Escape}");

    await expect(
      canvas.queryByTestId("wishlists-picker-menu"),
    ).not.toBeInTheDocument();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};

export const PhonePickerClosesOnScrimClick: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByTestId("wishlists-picker-trigger");
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);

    await userEvent.click(await canvas.findByTestId("wishlists-picker-scrim"));

    await expect(
      canvas.queryByTestId("wishlists-picker-menu"),
    ).not.toBeInTheDocument();
  },
};

export const HoldsSkeletonsUntilTheListAnswers: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/wishlists"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering the wishlists"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(canvas.getByTestId("wishlists-panel")).getByTestId(
          "wishlists-reader-everyone",
        ),
      ).toBeInTheDocument(),
    );
    await expect(
      canvas.queryByTestId("wishlists-empty"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("wishlists-heading"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText(/\bbooks?\b/)).not.toBeInTheDocument();
  },
};

export const PanelShowsSkeletonsUntilTheReadersAnswer: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/wishlists/readers"));
  },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("wishlists-row");
    const panel = canvas.getByTestId("wishlists-panel");
    await expect(
      within(panel).queryByTestId("wishlists-reader-everyone"),
    ).not.toBeInTheDocument();
    await expect(panel.querySelectorAll(".ld-skel").length).toBeGreaterThan(0);
  },
};

export const EmptyOwnListOffersToAdd: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ entries: new Map([[1, []]]) }));
  },
  play: async ({ canvas }) => {
    const empty = await canvas.findByTestId("wishlists-empty");
    await expect(empty).toHaveTextContent("Nothing on your wishlist yet");
    await expect(
      within(empty).getByRole("button", { name: "Add to your wishlist" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("wishlists-row")).not.toBeInTheDocument();
    await expect(
      empty.closest("[data-testid='wishlists-page']")?.textContent,
    ).not.toMatch(BANNED_COPY);
  },
};

export const EmptyEveryoneOffersToAdd: Story = {
  parameters: { path: "/wishlists?user=all" },
  beforeEach({ msw }) {
    msw.use(...api({ entries: new Map([[1, []]]) }));
  },
  play: async ({ canvas }) => {
    const empty = await canvas.findByTestId("wishlists-empty");
    await expect(empty).toHaveTextContent(
      "No one has anything on their wishlist yet",
    );
    await expect(
      within(empty).getByRole("button", { name: "Add to your wishlist" }),
    ).toBeInTheDocument();
    await expect(
      empty.closest("[data-testid='wishlists-page']")?.textContent,
    ).not.toMatch(BANNED_COPY);
  },
};

export const EmptyReaderListHasNoAddOffer: Story = {
  parameters: { path: "/wishlists?user=4" },
  play: async ({ canvas }) => {
    const empty = await canvas.findByTestId("wishlists-empty");
    await expect(empty).toHaveTextContent("Nothing on Sam’s wishlist yet");
    await expect(within(empty).queryByRole("button")).not.toBeInTheDocument();
  },
};

export const UnknownReaderOffersYourOwnList: Story = {
  parameters: { path: "/wishlists?user=99" },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "That reader isn't on this server",
    );

    await userEvent.click(
      canvas.getByRole("link", { name: "Back to your wishlist" }),
    );

    await expect(
      await canvas.findByTestId("wishlists-heading"),
    ).toHaveTextContent("Your Wishlist");
  },
};

export const OtherFailureShowsItsMessage: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/wishlists", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
  },
};

export const UsesNoWishOrCheckInCopy: Story = {
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("wishlists-row");
    await expect(canvas.getByTestId("wishlists-page").textContent).not.toMatch(
      BANNED_COPY,
    );
  },
};
