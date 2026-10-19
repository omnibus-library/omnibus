import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";
import { failing, paletteHandler } from "../../testing/handlers";
import { aWirePalette, aWirePaletteBook } from "../../testing/wire";
import {
  BOOK,
  CLOSE_MATCH,
  type Ctx,
  checkedIn,
  handlers,
  ISBN,
  lookUp,
  ONLINE,
  Page,
  physicalOnly,
  resetCheckIn,
  resolved,
  resolvedMeta,
  searched,
  wishlisted,
} from "./CheckIn.stories.shared";

const meta = {
  title: "Pages/CheckIn/Search",
  component: Page,
  parameters: { path: "/check-in" },
  beforeEach: resetCheckIn,
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Searches the lookup's title field and waits for the results. */
async function searchTitle({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.type(await canvas.findByLabelText("Title"), "  harbour ");
  await userEvent.click(canvas.getByTestId("check-in-search-submit"));
  await canvas.findByTestId("check-in-search-results");
}

export const SearchesByTitleBesideTheIsbnField: Story = {
  play: async ({ canvas, userEvent }) => {
    const submit = await canvas.findByTestId("check-in-search-submit");
    await expect(canvas.getByTestId("check-in-or")).toHaveTextContent("or");
    await expect(submit).toBeDisabled();

    await searchTitle({ canvas, userEvent });

    await expect(searched).toEqual(["harbour"]);
    const results = canvas.getAllByTestId("check-in-search-result");
    await expect(results).toHaveLength(2);
    await expect(results[0]).toHaveTextContent("Harbour Lights");
    await expect(results[0]).toHaveTextContent("Ines Varga · 2021");
    await expect(canvas.getByTestId("check-in-isbn")).toBeInTheDocument();
  },
};

export const SearchWithNoMatches: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }, { found: [] }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Title"), "zzz");
    await userEvent.click(canvas.getByTestId("check-in-search-submit"));

    await expect(
      await canvas.findByTestId("check-in-search-empty"),
    ).toHaveTextContent("No books match that title.");
  },
};

export const SearchFailsAndKeepsTheResults: Story = {
  beforeEach({ msw }) {
    let calls = 0;
    msw.use(
      http.post("/api/scan/search", () =>
        ++calls === 1
          ? HttpResponse.json({ results: [ONLINE] })
          : new HttpResponse("providers are down", { status: 503 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });

    await userEvent.click(canvas.getByTestId("check-in-search-submit"));

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not search: providers are down",
    );
    await expect(
      canvas.getByTestId("check-in-search-results"),
    ).toBeInTheDocument();
  },
};

export const PickingAResultResolvesItBySearch: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await canvas.findByTestId("check-in-choose");
    await expect(resolvedMeta).toEqual([ONLINE]);
    await expect(resolved).toEqual([]);
    await userEvent.click(canvas.getByTestId("check-in-wishlist"));
    await canvas.findByTestId("check-in-success");
    await expect(wishlisted).toEqual([{ meta: ONLINE, source: "search" }]);
  },
};

export const PickedResultInTheLibraryConfirmsWithTheEditionsIsbn: Story = {
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`ISBN ${ONLINE.isbn13}, from the edition you picked`);
  },
};

export const PickedResultAlreadyOwnedOpensTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "already_owned", book: BOOK }));
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};

export const PickFailsAndKeepsTheResults: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "unresolved" },
        { refuse: { resolveMeta: "no match" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not match that book: no match",
    );
    await expect(
      canvas.getByTestId("check-in-search-results"),
    ).toBeInTheDocument();
  },
};

export const ClosePickedResultWordsTheSubtitleBySearch: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers(CLOSE_MATCH([])));
  },
  play: async ({ canvas, userEvent }) => {
    await searchTitle({ canvas, userEvent });
    await userEvent.click(
      canvas.getAllByTestId("check-in-search-result")[0] as HTMLElement,
    );

    await expect(
      await canvas.findByTestId("check-in-close-match"),
    ).toHaveTextContent(
      "That edition's ISBN isn't on any book in your library",
    );
  },
};

const LIBRARY = aWirePalette({
  books: [
    aWirePaletteBook({
      uuid: "11111111-1111-4111-8111-111111111111",
      title: "Harbour Lights (print)",
      author_display: "Varga, Ines",
      formats: ["EPUB"],
    }),
    aWirePaletteBook({
      uuid: "22222222-2222-4222-8222-222222222222",
      title: "Lights of the Harbour",
      author_display: "",
      formats: [],
    }),
  ],
  book_total: 7,
});

const toLink = async ({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) => {
  await lookUp({ canvas, userEvent });
  await userEvent.click(await canvas.findByTestId("check-in-link-existing"));
  await canvas.findByTestId("check-in-link");
};

export const LinksACopyToABookOnTheShelf: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "not_in_library", online: ONLINE }),
      paletteHandler(LIBRARY),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await expect(canvas.getByTestId("check-in-link")).toHaveTextContent(
      "Which book is this?",
    );
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(
      canvas.getByRole("button", { name: "Search my library" }),
    );

    const picks = await canvas.findAllByTestId("check-in-link-pick");
    await expect(picks).toHaveLength(2);
    await expect(
      canvas.getByTestId("check-in-link-truncated"),
    ).toHaveTextContent(
      "Showing 2 of 7 matches — add the author or more of the title.",
    );
    await expect(canvas.getByText("Varga, Ines")).toBeInTheDocument();

    await userEvent.click(picks[0] as HTMLElement);

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent("You already have this one digitally");
    await userEvent.click(canvas.getByTestId("check-in-confirm-submit"));
    await canvas.findByTestId("check-in-success");
    await expect(checkedIn).toEqual([
      {
        book_uuid: "11111111-1111-4111-8111-111111111111",
        isbn: ONLINE.isbn13,
      },
    ]);
    await expect(physicalOnly).toEqual([]);
  },
};

export const LinkSearchWithNoMatches: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "not_in_library", online: ONLINE }),
      paletteHandler(aWirePalette({ books: [] })),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText("Title or author"), "nothing");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));

    await expect(
      await canvas.findByTestId("check-in-link-empty"),
    ).toHaveTextContent("No book in your library matches that.");
    await expect(canvas.queryByTestId("check-in-link-truncated")).toBeNull();
  },
};

export const LinkSearchFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "not_in_library", online: ONLINE }),
      failing("get", "/api/search/palette", 500),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));

    await expect(await canvas.findByTestId("check-in-error")).toHaveTextContent(
      "Could not search your library: failed with 500",
    );
  },
};

export const LinkBackRestoresTheChooser: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "not_in_library", online: ONLINE }));
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });

    await userEvent.click(canvas.getByTestId("check-in-link-back"));

    await expect(
      await canvas.findByTestId("check-in-choose"),
    ).toHaveTextContent("Harbour Lights");
  },
};

export const LinkFromUnresolvedConfirmsWithTheTypedIsbn: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }), paletteHandler(LIBRARY));
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));
    await userEvent.click(
      (await canvas.findAllByTestId("check-in-link-pick"))[1] as HTMLElement,
    );
    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Entered ISBN ${ISBN}`);
  },
};

export const UnresolvedOffersTitleSearchInstead: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers({ kind: "unresolved" }),
      failing("get", "/api/search/palette", 500),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await lookUp({ canvas, userEvent });
    // A failed link search leaves its error up when Back returns here.
    await userEvent.click(await canvas.findByTestId("check-in-link-existing"));
    await userEvent.type(canvas.getByLabelText("Title or author"), "harbour");
    await userEvent.click(canvas.getByTestId("check-in-link-submit"));
    await canvas.findByTestId("check-in-error");
    await userEvent.click(canvas.getByTestId("check-in-link-back"));
    await expect(
      await canvas.findByTestId("check-in-unresolved"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-error")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("check-in-search-instead"));

    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("check-in-error")).toBeNull();
  },
};

export const LinkBackRestoresUnresolved: Story = {
  beforeEach({ msw }) {
    msw.use(...handlers({ kind: "unresolved" }));
  },
  play: async ({ canvas, userEvent }) => {
    await toLink({ canvas, userEvent });

    await userEvent.click(canvas.getByTestId("check-in-link-back"));

    await expect(
      await canvas.findByTestId("check-in-unresolved"),
    ).toHaveTextContent(ISBN);
  },
};
