import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { deferred } from "../../testing/handlers";
import { BOOKS } from "../../testing/wishlistHandlers";
import { api, fake, Page, PHONE } from "./Wishlists.stories.shared";

const meta = {
  title: "Pages/Wishlists/Actions",
  component: Page,
  parameters: { path: "/wishlists" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

const rowOf = async (canvas: Canvas, title: string) => {
  const rows = await canvas.findAllByTestId("wishlists-row");
  const row = rows.find((r: HTMLElement) =>
    within(r).queryByRole("link", { name: title }),
  );
  if (!row) throw new Error(`no row for ${title}`);
  return within(row);
};

const titles = async (canvas: Canvas) =>
  (await canvas.findAllByTestId("wishlists-row")).map(
    (row: HTMLElement) =>
      within(row).getByTestId("wishlists-title").textContent,
  );

export const FindACopyOpensAnAmazonSearchInANewTab: Story = {
  play: async ({ canvas }) => {
    const link = (await rowOf(canvas, "Hyperion")).getByRole("link", {
      name: "Find a Copy",
    });

    await expect(link).toHaveAttribute(
      "href",
      "https://www.amazon.com/s?k=Hyperion%20Dan%20Simmons",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link.getAttribute("rel")).toContain("noopener");
    await expect(link.getAttribute("rel")).toContain("noreferrer");
  },
};

export const FindACopySearchesTheIsbnWhenTheBookHasOne: Story = {
  parameters: { path: "/wishlists?user=all" },
  play: async ({ canvas }) => {
    const link = (await rowOf(canvas, "Piranesi")).getByRole("link", {
      name: "Find a Copy",
    });

    await expect(link).toHaveAttribute(
      "href",
      "https://www.amazon.com/s?k=9781635575637",
    );
  },
};

export const RequestIsDisabledWithItsReason: Story = {
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "Hyperion");
    const request = row.getByTestId("wishlists-request");

    await expect(request).toHaveAttribute("aria-disabled", "true");
    await expect(request).toHaveAccessibleDescription(
      "Requests aren't available yet",
    );
    await userEvent.click(request);

    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
    await expect(fake.writes).toEqual([]);
    request.focus();
    await expect(request).toHaveFocus();
  },
};

/** The browser's own pointer: a story's `userEvent` is synthetic and never sets `:hover`. */
const realPointer = async () => (await import("vitest/browser")).userEvent;

export const RequestShowsItsTooltipOnHover: Story = {
  play: async ({ canvas }) => {
    const row = await rowOf(canvas, "Hyperion");
    const tip = row.getByRole("tooltip");
    await expect(getComputedStyle(tip).opacity).toBe("0");

    await (await realPointer()).hover(row.getByTestId("wishlists-request"));

    await waitFor(() => expect(getComputedStyle(tip).opacity).toBe("1"));
    await expect(tip).toHaveTextContent("Requests aren't available yet");
  },
};

export const RequestIsHiddenWhenBothKindsAreHeld: Story = {
  play: async ({ canvas }) => {
    const redRising = await rowOf(canvas, "Red Rising");
    await expect(redRising.queryByTestId("wishlists-request")).toBeNull();

    // One ebook alone still leaves the audiobook to ask for.
    const systemsRed = await rowOf(canvas, "All Systems Red");
    await expect(
      systemsRed.getByTestId("wishlists-request"),
    ).toBeInTheDocument();
  },
};

export const ActionsStayLaidOutAndShowOnHoverOrFocus: Story = {
  play: async ({ canvas }) => {
    const hyperion = await rowOf(canvas, "Hyperion");
    const redRising = await rowOf(canvas, "Red Rising");
    const slot = (row: typeof hyperion) =>
      row.getByTestId("wishlists-find-copy").parentElement as HTMLElement;
    await expect(getComputedStyle(slot(hyperion)).opacity).toBe("0");
    // Red Rising has one button fewer, and its slot is the same width.
    await expect(slot(redRising).getBoundingClientRect().width).toBe(
      slot(hyperion).getBoundingClientRect().width,
    );

    const pointer = await realPointer();
    await pointer.hover(hyperion.getByTestId("wishlists-title"));
    await waitFor(() =>
      expect(getComputedStyle(slot(hyperion)).opacity).toBe("1"),
    );
    await pointer.unhover(hyperion.getByTestId("wishlists-title"));

    redRising.getByTestId("wishlists-find-copy").focus();
    await waitFor(() =>
      expect(getComputedStyle(slot(redRising)).opacity).toBe("1"),
    );
  },
};

export const ActionsHaveAmberFocusOutlines: Story = {
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "All Systems Red");
    await userEvent.tab();
    const focusable = [
      row.getByTestId("wishlists-find-copy"),
      row.getByTestId("wishlists-request"),
      row.getByTestId("wishlists-remove"),
    ];
    for (const control of focusable) {
      control.focus();
      await userEvent.keyboard("{Shift>}{Shift}");
      await waitFor(() =>
        expect(getComputedStyle(control).outlineStyle).toBe("solid"),
      );
      await expect(getComputedStyle(control).outlineWidth).toBe("2px");
    }
  },
};

export const RemoveThenUndoRestoresTheRow: Story = {
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "All Systems Red");

    await userEvent.click(row.getByTestId("wishlists-remove"));

    await expect(
      await canvas.findByText("Removed All Systems Red from your wishlist"),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect(await titles(canvas)).toEqual([
        "Hyperion",
        "Project Hail Mary",
        "Red Rising",
      ]),
    );
    await waitFor(() =>
      expect(
        within(canvas.getByTestId("wishlists-panel")).getByTestId(
          "wishlists-reader-you",
        ),
      ).toHaveTextContent("You3"),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));

    await waitFor(async () =>
      expect(await titles(canvas)).toContain("All Systems Red"),
    );
    await expect(titles(canvas)).resolves.toHaveLength(4);
    await expect(fake.writes).toEqual([
      { kind: "remove", uuid: BOOKS.allSystemsRed.uuid },
      { kind: "add", uuid: BOOKS.allSystemsRed.uuid },
    ]);
  },
};

export const RemovingABookOnlyYouWantedOffersNoUndo: Story = {
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "Hyperion");

    await userEvent.click(row.getByTestId("wishlists-remove"));

    await expect(
      await canvas.findByText("Removed Hyperion from your wishlist"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    await waitFor(async () =>
      expect(await titles(canvas)).not.toContain("Hyperion"),
    );
  },
};

let held = deferred();

export const RemoveIsDisabledWhileItsRequestIsPending: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      http.delete("/api/physical/:uuid/wishlist", async () => {
        await held.promise;
        return HttpResponse.json({ book_deleted: false });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const remove = (await rowOf(canvas, "All Systems Red")).getByTestId(
      "wishlists-remove",
    );

    await userEvent.click(remove);

    await waitFor(() => expect(remove).toBeDisabled());
    held.release();
    await waitFor(() => expect(remove).toBeEnabled());
  },
};

export const FailedRemoveShowsTheErrorAndKeepsTheRow: Story = {
  play: async ({ canvas, userEvent }) => {
    fake.refuse.remove = true;
    const row = await rowOf(canvas, "All Systems Red");

    await userEvent.click(row.getByTestId("wishlists-remove"));

    await expect(
      await canvas.findByText(
        "Couldn’t remove All Systems Red: failed with 500",
      ),
    ).toBeInTheDocument();
    await expect(await titles(canvas)).toContain("All Systems Red");
    await expect(row.getByTestId("wishlists-remove")).toBeEnabled();
  },
};

export const NoRemoveOnAnotherReadersList: Story = {
  parameters: { path: "/wishlists?user=2" },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("wishlists-row");

    await expect(canvas.queryByTestId("wishlists-remove")).toBeNull();
    await expect(
      canvas.queryAllByTestId("wishlists-find-copy").length,
    ).toBeGreaterThan(0);
  },
};

export const NoRemoveOnEveryone: Story = {
  parameters: { path: "/wishlists?user=all" },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("wishlists-row");

    await expect(canvas.queryByTestId("wishlists-remove")).toBeNull();
  },
};

export const GetSheetOnYourListOffersFindRequestOpenAndRemove: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "Hyperion");
    await expect(row.getByTestId("wishlists-find-copy")).not.toBeVisible();

    await userEvent.click(row.getByTestId("wishlists-get"));

    const sheet = within(await canvas.findByTestId("wishlists-get-sheet"));
    await expect(
      sheet.getByRole("heading", { name: "Hyperion" }),
    ).toBeInTheDocument();
    await expect(
      sheet.getByText("Dan Simmons · added Oct 30"),
    ).toBeInTheDocument();
    const find = sheet.getByRole("link", { name: /Find a copy/ });
    await expect(find).toHaveAttribute(
      "href",
      "https://www.amazon.com/s?k=Hyperion%20Dan%20Simmons",
    );
    await expect(find).toHaveAttribute("target", "_blank");
    for (const name of ["Request ebook", "Request audiobook"]) {
      const item = sheet.getByRole("button", { name: new RegExp(name) });
      await expect(item).toBeDisabled();
      await expect(item).toHaveTextContent("Not available yet");
    }
    await expect(
      sheet.getByRole("link", { name: "Open book page" }),
    ).toHaveAttribute("href", `/books/${BOOKS.hyperion.uuid}`);
    await expect(
      sheet.getByRole("button", { name: "Remove from wishlist" }),
    ).toBeInTheDocument();
  },
};

export const GetSheetOnAnotherReadersListHasNoRemove: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/wishlists?user=2" },
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "Project Hail Mary");

    await userEvent.click(row.getByTestId("wishlists-get"));

    const sheet = within(await canvas.findByTestId("wishlists-get-sheet"));
    await expect(
      sheet.getByText("Andy Weir · added Oct 28"),
    ).toBeInTheDocument();
    await expect(
      sheet.getByRole("link", { name: /Find a copy/ }),
    ).toBeInTheDocument();
    // An epub is held, so only the audiobook is left to ask for.
    await expect(
      sheet.queryByRole("button", { name: /Request ebook/ }),
    ).toBeNull();
    await expect(
      sheet.getByRole("button", { name: /Request audiobook/ }),
    ).toBeDisabled();
    await expect(
      sheet.queryByRole("button", { name: "Remove from wishlist" }),
    ).toBeNull();
  },
};

export const GetSheetOnEveryoneNamesWhoWantsTheBook: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/wishlists?user=all" },
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "Piranesi");

    await userEvent.click(row.getByTestId("wishlists-get"));

    const sheet = within(await canvas.findByTestId("wishlists-get-sheet"));
    await expect(
      sheet.getByText("Susanna Clarke · wanted by Jordan, Riley"),
    ).toBeInTheDocument();
    await expect(
      sheet.queryByRole("button", { name: "Remove from wishlist" }),
    ).toBeNull();
  },
};

export const RemovingFromTheGetSheetClosesItAndConfirms: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const row = await rowOf(canvas, "All Systems Red");
    await userEvent.click(row.getByTestId("wishlists-get"));
    const sheet = within(await canvas.findByTestId("wishlists-get-sheet"));

    await userEvent.click(
      sheet.getByRole("button", { name: "Remove from wishlist" }),
    );

    await expect(
      await canvas.findByText("Removed All Systems Red from your wishlist"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        canvas.queryByTestId("wishlists-get-sheet"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(async () =>
      expect(await titles(canvas)).not.toContain("All Systems Red"),
    );
  },
};

export const GetButtonIsHiddenOnAWideScreen: Story = {
  play: async ({ canvas }) => {
    const row = await rowOf(canvas, "Hyperion");

    await expect(row.getByTestId("wishlists-get")).not.toBeVisible();
  },
};
