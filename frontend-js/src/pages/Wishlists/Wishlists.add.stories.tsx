import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { deferred, hanging } from "../../testing/handlers";
import { BOOKS } from "../../testing/wishlistHandlers";
import {
  api,
  type Canvas,
  fake,
  Page,
  PHONE,
  titles,
} from "./Wishlists.stories.shared";

const meta = {
  title: "Pages/Wishlists/Add",
  component: Page,
  parameters: { path: "/wishlists" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens the panel from the header and types `text` into its search. */
const search = async (
  canvas: Canvas,
  userEvent: {
    click: (e: Element) => Promise<void>;
    type: (e: Element, text: string) => Promise<void>;
  },
  text: string,
) => {
  await userEvent.click(await canvas.findByTestId("wishlists-add"));
  const panel = within(await canvas.findByTestId("wishlists-add-panel"));
  await userEvent.type(panel.getByTestId("wishlists-add-search"), text);
  return panel;
};

const resultTitles = (section: ReturnType<typeof within>) =>
  section
    .queryAllByTestId("wishlists-add-result")
    .map((r: HTMLElement) => r.querySelector(".wl-add-title")?.textContent);

export const OpensFocusedWithItsHint: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("wishlists-add");
    await expect(button).toHaveAccessibleName("Add to wishlist");
    await expect(button).toHaveTextContent("Add to wishlist");

    await userEvent.click(button);

    const panel = await canvas.findByTestId("wishlists-add-panel");
    await expect(
      within(panel).getByTestId("wishlists-add-search"),
    ).toHaveFocus();
    await expect(panel).toHaveTextContent(
      "Title, author or ISBN. Adds to your wishlist.",
    );
    await expect(button).toHaveAttribute("aria-expanded", "true");
  },
};

export const TitleSearchListsLibraryBooksBeforeProviderBooks: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "piranesi");

    const library = within(await panel.findByTestId("wishlists-add-library"));
    const online = within(await panel.findByTestId("wishlists-add-online"));
    await waitFor(() =>
      expect(resultTitles(online)).toEqual([
        "Piranesi",
        "Piranesi and the Vanishing House",
      ]),
    );
    await expect(
      library.getByRole("heading", { name: "In your library" }),
    ).toBeInTheDocument();
    // The library holds no file or copy of Piranesi: it is only wanted, so the palette hides it.
    await expect(library.getByText("Nothing matches")).toBeInTheDocument();
    await expect(
      online.getByRole("heading", { name: "From Open Library" }),
    ).toBeInTheDocument();
    await expect(
      panel
        .getByTestId("wishlists-add-library")
        .compareDocumentPosition(panel.getByTestId("wishlists-add-online")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

export const LibraryAnswersWhileTheProvidersAreStillSearching: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/scan/search", "post"));
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "dune");

    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() => expect(resultTitles(library)).toEqual(["Dune"]));
    await expect(
      library.getByText("Frank Herbert · in the library"),
    ).toBeInTheDocument();
    const online = within(panel.getByTestId("wishlists-add-online"));
    await expect(online.getByText("Searching…")).toBeInTheDocument();
    await expect(online.queryByText("Nothing matches")).not.toBeInTheDocument();
  },
};

export const IsbnSearchResolvesTheLibraryBook: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "9781635575637");

    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() => expect(resultTitles(library)).toEqual(["Piranesi"]));
    await expect(
      within(panel.getByTestId("wishlists-add-online")).getByText(
        "Nothing matches",
      ),
    ).toBeInTheDocument();
  },
};

export const IsbnSearchOfAnUnknownBookOffersTheProvidersRecord: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "978-0-306-40615-7");

    const online = within(await panel.findByTestId("wishlists-add-online"));
    await waitFor(() =>
      expect(resultTitles(online)).toEqual([
        "Piranesi and the Vanishing House",
      ]),
    );
    await expect(
      within(panel.getByTestId("wishlists-add-library")).getByText(
        "Nothing matches",
      ),
    ).toBeInTheDocument();
  },
};

export const AddingALibraryBookToYourListOffersUndo: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "way of kings");
    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() =>
      expect(resultTitles(library)).toEqual(["The Way of Kings"]),
    );

    await userEvent.click(
      library.getByRole("button", { name: "Add The Way of Kings" }),
    );

    await expect(
      await canvas.findByText("Added The Way of Kings to your wishlist"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("wishlists-add-panel"),
    ).not.toBeInTheDocument();
    await expect(fake.scanWrites).toEqual([
      { book_uuid: BOOKS.wayOfKings.uuid, source: "search" },
    ]);
    await waitFor(async () =>
      expect(await titles(canvas)).toContain("The Way of Kings"),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));

    await waitFor(async () =>
      expect(await titles(canvas)).not.toContain("The Way of Kings"),
    );
    await expect(fake.writes).toEqual([
      { kind: "remove", uuid: BOOKS.wayOfKings.uuid },
    ]);
  },
};

export const AddingABookAlreadyOnYourListOffersNoUndo: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "hail mary");
    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() =>
      expect(resultTitles(library)).toEqual(["Project Hail Mary"]),
    );

    await userEvent.click(
      library.getByRole("button", { name: "Add Project Hail Mary" }),
    );

    await expect(
      await canvas.findByText("Project Hail Mary is already on your wishlist"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  },
};

export const AddingAProvidersRecordOfABookTheLibraryHasAddsThatBook: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "piranesi");
    const online = within(await panel.findByTestId("wishlists-add-online"));
    await waitFor(() => expect(resultTitles(online)).toContain("Piranesi"));
    const booksBefore = fake.state.books.size;

    // Piranesi has no file or copy: the book exists only because Jordan and Riley want it.
    await userEvent.click(online.getByRole("button", { name: "Add Piranesi" }));

    await expect(
      await canvas.findByText("Added Piranesi to your wishlist"),
    ).toBeInTheDocument();
    await expect(fake.scanWrites).toEqual([
      { book_uuid: BOOKS.piranesi.uuid, source: "search" },
    ]);
    await expect(fake.state.books.size).toBe(booksBefore);
    await waitFor(async () =>
      expect(await titles(canvas)).toContain("Piranesi"),
    );
  },
};

export const AddingAProvidersRecordNoBookMatchesMakesANewBook: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "9780306406157");
    const online = within(await panel.findByTestId("wishlists-add-online"));
    await waitFor(() => expect(resultTitles(online)).toHaveLength(1));
    const booksBefore = fake.state.books.size;

    await userEvent.click(
      online.getByRole("button", {
        name: "Add Piranesi and the Vanishing House",
      }),
    );

    await expect(
      await canvas.findByText(
        "Added Piranesi and the Vanishing House to your wishlist",
      ),
    ).toBeInTheDocument();
    await expect(fake.scanWrites).toHaveLength(1);
    await expect(fake.scanWrites[0]?.meta?.isbn13).toBe("9780306406157");
    await expect(fake.scanWrites[0]?.source).toBe("manual");
    await expect(fake.state.books.size).toBe(booksBefore + 1);
  },
};

export const FailedAddStaysOpenWithTheMessage: Story = {
  play: async ({ canvas, userEvent }) => {
    fake.refuse.scan = true;
    const panel = await search(canvas, userEvent, "way of kings");
    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() => expect(resultTitles(library)).toHaveLength(1));

    await userEvent.click(
      library.getByRole("button", { name: "Add The Way of Kings" }),
    );

    await expect(await panel.findByRole("alert")).toHaveTextContent(
      "Couldn’t add The Way of Kings: failed with 500",
    );
    await expect(canvas.getByTestId("wishlists-add-panel")).toBeInTheDocument();
    await expect(
      library.getByRole("button", { name: "Add The Way of Kings" }),
    ).toBeEnabled();
  },
};

let held = deferred();

export const AddIsDisabledWhileItsRequestIsPending: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      http.post("/api/scan/wishlist", async () => {
        await held.promise;
        return HttpResponse.json({ book_uuid: BOOKS.wayOfKings.uuid });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "way of kings");
    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() => expect(resultTitles(library)).toHaveLength(1));
    const add = library.getByRole("button", { name: "Add The Way of Kings" });

    await userEvent.click(add);

    await waitFor(() => expect(add).toBeDisabled());
    // Nothing closes the panel while the add is in flight.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByTestId("wishlists-add-scrim"));
    await expect(canvas.getByTestId("wishlists-add-panel")).toBeInTheDocument();
    held.release();
    await waitFor(() =>
      expect(
        canvas.queryByTestId("wishlists-add-panel"),
      ).not.toBeInTheDocument(),
    );
  },
};

export const EscapeClosesThePanelAndReturnsFocusToTheButton: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("wishlists-add");
    await userEvent.click(button);
    await canvas.findByTestId("wishlists-add-panel");

    await userEvent.keyboard("{Escape}");

    await expect(
      canvas.queryByTestId("wishlists-add-panel"),
    ).not.toBeInTheDocument();
    await expect(button).toHaveFocus();
  },
};

export const ScrimClickClosesThePanelAndReturnsFocusToTheButton: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("wishlists-add");
    await userEvent.click(button);

    await userEvent.click(await canvas.findByTestId("wishlists-add-scrim"));

    await expect(
      canvas.queryByTestId("wishlists-add-panel"),
    ).not.toBeInTheDocument();
    await expect(button).toHaveFocus();
  },
};

export const AddShowsOnEveryoneAndAnotherReadersList: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = within(await canvas.findByTestId("wishlists-panel"));
    await canvas.findAllByTestId("wishlists-row");
    await userEvent.click(panel.getByTestId("wishlists-reader-everyone"));
    await expect(
      await canvas.findByTestId("wishlists-add"),
    ).toBeInTheDocument();

    await userEvent.click(panel.getByTestId("wishlists-reader-2"));

    await expect(
      await canvas.findByTestId("wishlists-add"),
    ).toBeInTheDocument();
  },
};

export const EmptyStateOffersTheSamePanel: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ entries: new Map([[1, []]]) }));
  },
  play: async ({ canvas, userEvent }) => {
    const empty = await canvas.findByTestId("wishlists-empty");

    await userEvent.click(
      within(empty).getByRole("button", { name: "Add to your wishlist" }),
    );

    await expect(
      await canvas.findByTestId("wishlists-add-panel"),
    ).toBeInTheDocument();
  },
};

export const PhoneShowsAPlusAndAModalSheet: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("wishlists-add");
    await expect(button).toHaveAccessibleName("Add to wishlist");
    await expect(within(button).getByText("Add to wishlist")).not.toBeVisible();

    await userEvent.click(button);

    const dialog = await canvas.findByRole("dialog", {
      name: "Add to your wishlist",
    });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const panel = within(await canvas.findByTestId("wishlists-add-panel"));
    // The keyboard would cover the sheet the moment it opened.
    await expect(panel.getByTestId("wishlists-add-search")).not.toHaveFocus();
    // The sheet fades in, and a fading element is not yet visible.
    await waitFor(() =>
      expect(
        panel.getByRole("heading", { name: "Add to your wishlist" }),
      ).toBeVisible(),
    );
    await userEvent.click(panel.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(
        canvas.queryByTestId("wishlists-add-panel"),
      ).not.toBeInTheDocument(),
    );
    await expect(button).toHaveFocus();
  },
};

export const PhoneSheetClosesOnEscape: Story = {
  ...PHONE,
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByTestId("wishlists-add");
    await userEvent.click(button);
    await canvas.findByTestId("wishlists-add-panel");

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        canvas.queryByTestId("wishlists-add-panel"),
      ).not.toBeInTheDocument(),
    );
    await expect(button).toHaveFocus();
  },
};

/** The browser's own pointer: a story's `userEvent` dispatches straight to its target, past any overlay. */
const realPointer = async () => (await import("vitest/browser")).userEvent;

export const AnOutsideClickClosesTheDesktopPopover: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("wishlists-add"));
    await canvas.findByTestId("wishlists-add-panel");

    // `force` skips the check that nothing covers the heading: the covering scrim is what is under test.
    await (await realPointer()).click(
      await canvas.findByTestId("wishlists-heading"),
      { force: true },
    );

    await waitFor(() =>
      expect(
        canvas.queryByTestId("wishlists-add-panel"),
      ).not.toBeInTheDocument(),
    );
  },
};

export const AnIsbnSearchAddsTheCloseMatchWithoutAskingAgain: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "9780441172719");
    const online = within(await panel.findByTestId("wishlists-add-online"));
    await waitFor(() => expect(resultTitles(online)).toEqual(["Dune"]));
    const booksBefore = fake.state.books.size;

    await userEvent.click(online.getByRole("button", { name: "Add Dune" }));

    await expect(
      await canvas.findByText("Added Dune to your wishlist"),
    ).toBeInTheDocument();
    await expect(fake.scanWrites).toEqual([
      { book_uuid: BOOKS.dune.uuid, source: "manual" },
    ]);
    await expect(fake.state.books.size).toBe(booksBefore);
    // The lookup had already answered, so the record was not matched a second time.
    await expect(fake.metaLookups).toEqual([]);
  },
};

export const AddingAProvidersRecordThatCloseMatchesAddsTheMatchedBook: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "dune");
    const online = within(await panel.findByTestId("wishlists-add-online"));
    await waitFor(() => expect(resultTitles(online)).toEqual(["Dune"]));
    const booksBefore = fake.state.books.size;

    // Another edition of the same work is the same book.
    await userEvent.click(online.getByRole("button", { name: "Add Dune" }));

    await expect(
      await canvas.findByText("Added Dune to your wishlist"),
    ).toBeInTheDocument();
    await expect(fake.scanWrites).toEqual([
      { book_uuid: BOOKS.dune.uuid, source: "search" },
    ]);
    await expect(fake.state.books.size).toBe(booksBefore);
    await expect(fake.metaLookups).toHaveLength(1);
  },
};

export const AddingAnEntryAlreadyOnYourListIsDecidedByTheBooksOwnRead: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = await search(canvas, userEvent, "hail mary");
    const library = within(await panel.findByTestId("wishlists-add-library"));
    await waitFor(() => expect(resultTitles(library)).toHaveLength(1));
    const listReads = fake.requests.length;

    await userEvent.click(
      library.getByRole("button", { name: "Add Project Hail Mary" }),
    );

    await canvas.findByText("Project Hail Mary is already on your wishlist");
    await expect(fake.entryReads).toEqual([BOOKS.hailMary.uuid]);
    // The only list read after the add is the page refreshing itself, never a pre-fetch.
    await expect(fake.requests.length - listReads).toBeLessThanOrEqual(1);
  },
};

export const ReaderSwitchAddRemoveFlow: Story = {
  play: async ({ canvas, userEvent }) => {
    const panel = within(await canvas.findByTestId("wishlists-panel"));
    const heading = () => canvas.findByTestId("wishlists-heading");
    const count = (testId: string) => panel.getByTestId(testId);

    // Your own list.
    await expect(await heading()).toHaveTextContent("Your Wishlist");
    await waitFor(() =>
      expect(count("wishlists-reader-you")).toHaveTextContent("You4"),
    );

    // Another reader's, then everyone's.
    await userEvent.click(panel.getByTestId("wishlists-reader-2"));
    await waitFor(async () =>
      expect(await heading()).toHaveTextContent("Jordan’s Wishlist"),
    );
    await userEvent.click(panel.getByTestId("wishlists-reader-everyone"));
    await waitFor(async () =>
      expect(await heading()).toHaveTextContent("Everyone’s Wishlists"),
    );
    await waitFor(() =>
      expect(count("wishlists-reader-everyone")).toHaveTextContent("Everyone8"),
    );

    // Add a book nobody wanted from the panel: it joins everyone's list and yours, one more each.
    await userEvent.click(canvas.getByTestId("wishlists-add"));
    await userEvent.type(
      within(await canvas.findByTestId("wishlists-add-panel")).getByTestId(
        "wishlists-add-search",
      ),
      "way of kings",
    );
    const library = within(await canvas.findByTestId("wishlists-add-library"));
    await waitFor(() => expect(resultTitles(library)).toHaveLength(1));
    await userEvent.click(
      library.getByRole("button", { name: "Add The Way of Kings" }),
    );
    await expect(
      await canvas.findByText("Added The Way of Kings to your wishlist"),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect(await titles(canvas)).toContain("The Way of Kings"),
    );
    const added = (await canvas.findAllByTestId("wishlists-row")).find(
      (r: HTMLElement) =>
        within(r).queryByRole("link", { name: "The Way of Kings" }),
    );
    await expect(added).toHaveTextContent("You");
    await waitFor(() =>
      expect(count("wishlists-reader-everyone")).toHaveTextContent("Everyone9"),
    );
    await waitFor(() =>
      expect(count("wishlists-reader-you")).toHaveTextContent("You5"),
    );

    // Your own list shows it first; remove it and the counts drop back.
    await userEvent.click(count("wishlists-reader-you"));
    await waitFor(async () =>
      expect(await heading()).toHaveTextContent("Your Wishlist"),
    );
    await waitFor(async () =>
      expect((await titles(canvas))[0]).toBe("The Way of Kings"),
    );
    const row = (
      await canvas.findAllByTestId("wishlists-row")
    )[0] as HTMLElement;
    await userEvent.click(within(row).getByTestId("wishlists-remove"));
    await expect(
      await canvas.findByText("Removed The Way of Kings from your wishlist"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(count("wishlists-reader-you")).toHaveTextContent("You4"),
    );
    await waitFor(() =>
      expect(count("wishlists-reader-everyone")).toHaveTextContent("Everyone8"),
    );
    await waitFor(async () =>
      expect(await titles(canvas)).not.toContain("The Way of Kings"),
    );
  },
};
