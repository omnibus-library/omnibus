import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { expect, waitFor } from "storybook/test";
import { formFromBook, hasProviderQuery, toEditableBook } from "../../api";
import type {
  EditionSearchRequest,
  EditionSearchResponse,
} from "../../api/generated/schemas";
import { storyClient } from "../../testing/AppHarness";
import { failing } from "../../testing/handlers";
import {
  anEditableWireBook,
  aProviderEdition,
  coverWriteHandlers,
  editionSearchHandler,
  hydrateHandler,
  providersHandler,
} from "../../testing/metadataHandlers";
import type { CoverProps, StagedCover } from "./CoverEditor";
import { EditionPicker } from "./EditionPicker";

const BOOK = anEditableWireBook();
const ANSWERED = { kind: "answered", count: 3 } as const;

// The search hit, and the same edition in full: it adds a description, a page
// count, a series statement, a second genre and an ISBN-10.
const HIT = aProviderEdition({
  title: "Aurora Station Volume 1",
  year: "2022",
  cover_url: "https://images.example.com/a.jpg",
});
const FULL = {
  ...HIT,
  description: "A revised edition.",
  pages: 352,
  series: "Aurora Station",
  series_index: "1",
  genres: ["Science fiction", "Space opera"],
  isbn10: "0134685997",
};

const STUDY_GUIDE = aProviderEdition({
  source: "google_books",
  provider_ref: "gb-study",
  title: "Aurora Station: A Study Guide",
  authors: ["Gale"],
  isbn13: "9781410336088",
  year: null,
  publisher: null,
});

const FOUND: EditionSearchResponse = {
  editions: [
    STUDY_GUIDE,
    aProviderEdition({
      source: "hardcover",
      provider_ref: "hc-work",
      title: "Aurora Station",
      authors: [],
      year: null,
      publisher: null,
      isbn13: null,
    }),
    HIT,
  ],
  sources: [
    {
      provider: "open_library",
      display_name: "Open Library",
      status: ANSWERED,
    },
    {
      provider: "google_books",
      display_name: "Google Books",
      status: ANSWERED,
    },
    { provider: "hardcover", display_name: "Hardcover", status: ANSWERED },
  ],
};

const searched: EditionSearchRequest[] = [];
const hydrated: string[] = [];
const fetchedCovers: string[] = [];

/** Stands in for the page: it owns the form and the cover, and shows what a copy did to them. */
function Picker({ stagedCover = false }: { stagedCover?: boolean }) {
  const form = useForm({ defaultValues: formFromBook(BOOK) });
  const [live, setLive] = useState(toEditableBook(BOOK));
  const [staged, setStaged] = useState<StagedCover>({
    source: { kind: "keep" },
    preview: null,
    originalPreview: null,
  });
  const cover: CoverProps = stagedCover
    ? {
        book: live,
        target: { kind: "staged", staged, onStage: setStaged },
        onApplied: () => {},
      }
    : {
        book: live,
        target: { kind: "live", uuid: live.uuid },
        onApplied: setLive,
      };
  return (
    <>
      <output aria-label="Form values">{JSON.stringify(form.watch())}</output>
      <output aria-label="Cover">
        {live.hasCoverOverride ? "replaced" : "scanned"} staged:
        {staged.source.kind}
      </output>
      <EditionPicker form={form} baseline={formFromBook(BOOK)} cover={cover} />
    </>
  );
}

const currentCoverSrc = (canvas: {
  getByTestId: (id: string) => HTMLElement;
}) =>
  canvas
    .getByTestId("mes-row-cover-current")
    .querySelector("img")
    ?.getAttribute("src") ?? "";

const meta = {
  title: "Pages/BookEdit/EditionPicker",
  component: Picker,
  beforeEach({ msw }) {
    searched.length = 0;
    hydrated.length = 0;
    fetchedCovers.length = 0;
    msw.use(
      providersHandler(true),
      editionSearchHandler(FOUND, { searched }),
      hydrateHandler({ OL1M: FULL }, { hydrated }),
      ...coverWriteHandlers(BOOK, { fetched: fetchedCovers }),
    );
  },
} satisfies Meta<typeof Picker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Waits for the provider check to settle, then proves the button never appeared. */
async function expectNoButton(canvas: { queryByTestId(id: string): unknown }) {
  await waitFor(() =>
    expect(
      storyClient().getQueryState(hasProviderQuery.queryKey)?.status,
    ).not.toBe("pending"),
  );
  await waitFor(() => expect(storyClient().isFetching()).toBe(0));
  await expect(canvas.queryByTestId("metadata-search-btn")).toBeNull();
}

export const HiddenWithoutAConfiguredProvider: Story = {
  beforeEach({ msw }) {
    msw.use(providersHandler(false));
  },
  play: async ({ canvas }) => expectNoButton(canvas),
};

export const HiddenWhenTheProviderCheckFails: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/metadata/providers", 500));
  },
  play: async ({ canvas }) => expectNoButton(canvas),
};

export const OpensOnTheReadyScreen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));

    const dialog = await canvas.findByRole("dialog", {
      name: "Find this edition",
    });
    await expect(dialog).toHaveTextContent("Find this edition");
    await expect(canvas.getByLabelText("Title")).toHaveValue(
      "Aurora Station, Vol. 1",
    );
    await expect(canvas.getByLabelText("Author")).toHaveValue("Sora Inkwell");
    await expect(canvas.getByLabelText("ISBN")).toHaveValue("9780134685991");
    await expect(canvas.getByTestId("mes-ready")).toBeInTheDocument();
    await expect(canvas.getByTestId("mes-search")).toBeEnabled();
    await expect(searched).toEqual([]);
  },
};

export const SearchNeedsOneField: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    for (const field of ["Title", "Author", "ISBN"]) {
      await userEvent.clear(await canvas.findByLabelText(field));
    }

    await expect(canvas.getByTestId("mes-search")).toBeDisabled();
    await userEvent.type(canvas.getByLabelText("ISBN"), "9780134685991");
    await expect(canvas.getByTestId("mes-search")).toBeEnabled();
  },
};

export const SendsTheFieldsThatAreFilled: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.clear(await canvas.findByLabelText("ISBN"));
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));

    await canvas.findByTestId("mes-candidates");
    await expect(searched).toEqual([
      {
        query: "Aurora Station, Vol. 1 Sora Inkwell",
        title: "Aurora Station, Vol. 1",
        author: "Sora Inkwell",
      },
    ]);
  },
};

export const ShowsSearchingWhileTheSourcesAnswer: Story = {
  beforeEach({ msw }) {
    msw.use(editionSearchHandler(FOUND, { gate: new Promise<void>(() => {}) }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));

    await expect(await canvas.findByTestId("mes-searching")).toHaveTextContent(
      "Asking every configured source…",
    );
    await expect(canvas.getByTestId("mes-search")).toBeDisabled();
    await expect(canvas.getByTestId("mes-search")).toHaveTextContent(
      "Searching…",
    );
  },
};

export const ListsTheCandidatesBestFirst: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));

    // The edition that accounts for the whole query leads; then the shorter title.
    const titles = (
      await canvas.findAllByTestId(/^mes-candidate-\d+-title$/)
    ).map((el) => el.textContent);
    await expect(titles).toEqual([
      "Aurora Station Volume 1",
      "Aurora Station",
      "Aurora Station: A Study Guide",
    ]);
    await expect(
      canvas.getByTestId("mes-candidate-0-imprint"),
    ).toHaveTextContent("2022 · Lantern Press · 9780134685991");
    await expect(canvas.getByTestId("mes-candidate-0-source")).toHaveAttribute(
      "data-source",
      "open-library",
    );
    await expect(
      canvas.getByTestId("mes-candidate-1-authors"),
    ).toHaveTextContent("—");
    await expect(
      canvas.getByTestId("mes-candidate-1-imprint"),
    ).toHaveTextContent("—");
    await expect(
      canvas.getByRole("button", {
        name: "Compare Aurora Station from Hardcover",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("mes-candidate-0").querySelector("img"),
    ).toHaveAttribute("src", "https://images.example.com/a.jpg");
  },
};

export const SaysWhatEachSourceDid: Story = {
  beforeEach({ msw }) {
    msw.use(
      editionSearchHandler({
        editions: FOUND.editions,
        sources: [
          {
            provider: "open_library",
            display_name: "Open Library",
            status: ANSWERED,
          },
          {
            provider: "google_books",
            display_name: "Google Books",
            status: { kind: "failed", message: "timed out" },
          },
          {
            provider: "hardcover",
            display_name: "Hardcover",
            status: { kind: "throttled", retry_after_secs: 45 },
          },
        ],
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));

    await expect(
      await canvas.findByTestId("mes-source-open-library"),
    ).toHaveTextContent("Open Library 3");
    const failed = canvas.getByTestId("mes-source-google-books");
    await expect(failed).toHaveTextContent("Google Books unavailable");
    await expect(failed).toHaveAttribute("title", "timed out");
    await expect(failed).toHaveClass("mes-source-problem");
    await expect(canvas.getByTestId("mes-source-hardcover")).toHaveTextContent(
      "Hardcover rate limited, skipping for 45s",
    );
  },
};

export const SaysNothingMatchedAndWhySourcesWereSkipped: Story = {
  beforeEach({ msw }) {
    msw.use(
      editionSearchHandler({
        editions: [],
        sources: [
          {
            provider: "open_library",
            display_name: "Open Library",
            status: { kind: "answered", count: 0 },
          },
          {
            provider: "hardcover",
            display_name: "Hardcover",
            status: { kind: "not_configured" },
          },
          {
            provider: "google_books",
            display_name: "Google Books",
            status: { kind: "throttled", retry_after_secs: 600 },
          },
        ],
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));

    await expect(await canvas.findByTestId("mes-empty")).toHaveTextContent(
      "No editions matched.",
    );
    await expect(
      canvas.getByTestId("mes-source-open-library"),
    ).toHaveTextContent("Open Library nothing");
    await expect(canvas.getByTestId("mes-source-hardcover")).toHaveTextContent(
      "Hardcover not set up",
    );
    await expect(
      canvas.getByTestId("mes-source-google-books"),
    ).toHaveTextContent("rate limited, skipping for 10m");
  },
};

export const KeepsTheFieldsWhenTheSearchFails: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/metadata/editions/search", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));

    await expect(await canvas.findByTestId("mes-error")).toHaveTextContent(
      "failed with 500",
    );
    await expect(canvas.getByRole("alert")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Title")).toHaveValue(
      "Aurora Station, Vol. 1",
    );
    await expect(canvas.getByTestId("mes-search")).toBeEnabled();
  },
};

export const ClosesAndStartsFreshOnEveryOpen: Story = {
  play: async ({ canvas, userEvent }) => {
    const open = await canvas.findByTestId("metadata-search-btn");
    const dialog = () =>
      canvas.queryByRole("dialog", { name: "Find this edition" });

    await userEvent.click(open);
    await userEvent.type(await canvas.findByLabelText("Title"), " edited");
    await userEvent.click(canvas.getByTestId("mes-close"));
    await waitFor(() => expect(dialog()).toBeNull());

    await userEvent.click(open);
    await expect(await canvas.findByLabelText("Title")).toHaveValue(
      "Aurora Station, Vol. 1",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());

    await userEvent.click(open);
    await userEvent.click(await canvas.findByTestId("metadata-search-scrim"));
    await waitFor(() => expect(dialog()).toBeNull());
  },
};

type Ctx = Parameters<NonNullable<Story["play"]>>[0];

/** Opens the picker, searches, and picks the first candidate. */
async function openCompare({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
  await userEvent.click(canvas.getByTestId("mes-search"));
  await userEvent.click(await canvas.findByTestId("mes-candidate-0"));
}

/** The form as the stand-in page holds it. */
const formValues = (canvas: Ctx["canvas"]) =>
  JSON.parse(canvas.getByLabelText("Form values").textContent ?? "{}");

export const OpensTheCompareScreenAtOnceAndHydratesBehindIt: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    msw.use(
      hydrateHandler(
        { OL1M: FULL },
        { hydrated, gates: { OL1M: new Promise<void>((r) => (release = r)) } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });

    await expect(canvas.getByTestId("mes-compare")).toHaveTextContent(
      "Aurora Station Volume 1",
    );
    await expect(canvas.getByTestId("mes-compare-source")).toHaveAttribute(
      "data-source",
      "open-library",
    );
    await expect(canvas.getByTestId("mes-hydrating")).toHaveTextContent(
      "Loading the full record…",
    );
    await expect(
      canvas.getByTestId("mes-compare-skeleton"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("mes-take-all")).toBeDisabled();
    await expect(canvas.queryByTestId("mes-row-title")).not.toBeInTheDocument();

    gate.release();
    // The description is only on the full record.
    await expect(
      await canvas.findByTestId("mes-row-description"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("mes-hydrating")).not.toBeInTheDocument();
    await expect(hydrated).toEqual(["OL1M"]);
    await expect(canvas.getByTestId("mes-take-all")).toBeEnabled();
  },
};
const gate = { release: () => {} };

export const KeepsTheListRowWhenTheProviderForgotTheEdition: Story = {
  beforeEach({ msw }) {
    msw.use(hydrateHandler({ OL1M: null }));
  },
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });

    await waitFor(() =>
      expect(canvas.queryByTestId("mes-hydrating")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("mes-row-title-source")).toHaveTextContent(
      "Aurora Station Volume 1",
    );
    await expect(
      canvas.queryByTestId("mes-row-description"),
    ).not.toBeInTheDocument();
  },
};

export const KeepsTheListRowWhenHydratingFails: Story = {
  beforeEach({ msw }) {
    msw.use(hydrateHandler({ OL1M: "fails" }));
  },
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("mes-row-title-source"),
    ).toHaveTextContent("Aurora Station Volume 1");
    await expect(canvas.getByTestId("mes-take-all")).toBeEnabled();
  },
};

export const DropsAHydrateForACandidateNoLongerShown: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    msw.use(
      hydrateHandler(
        {
          OL1M: FULL,
          "gb-study": { ...STUDY_GUIDE, title: "A Late Title" },
        },
        {
          hydrated,
          gates: { "gb-study": new Promise<void>((r) => (release = r)) },
        },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));
    // The study guide is third in the list; its answer is held back.
    await userEvent.click(await canvas.findByTestId("mes-candidate-2"));
    await userEvent.click(canvas.getByTestId("mes-compare-back"));
    await userEvent.click(await canvas.findByTestId("mes-candidate-0"));
    await expect(
      await canvas.findByTestId("mes-row-description"),
    ).toBeInTheDocument();

    gate.release();
    await waitFor(() => expect(hydrated).toEqual(["gb-study", "OL1M"]));
    // Another round trip through the screen, so the late answer has landed by now.
    await userEvent.click(canvas.getByTestId("mes-show-all"));

    await expect(
      await canvas.findByTestId("mes-row-cover"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("mes-compare")).toHaveTextContent(
      "Aurora Station Volume 1",
    );
    await expect(canvas.getByTestId("mes-compare")).not.toHaveTextContent(
      "A Late Title",
    );
  },
};

// The slow hydrate answers recorded as they leave the handler, so the play knows the late failure is on the wire.
const lateAnswers: string[] = [];

export const IgnoresASlowAnswerForAnEarlierOpeningOfTheSameCandidate: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    lateAnswers.length = 0;
    msw.use(
      http.post("/api/metadata/editions/hydrate", async () => {
        calls += 1;
        if (calls > 1) return HttpResponse.json(FULL);
        await held;
        lateAnswers.push("502");
        return new HttpResponse("provider unavailable", { status: 502 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await userEvent.click(canvas.getByTestId("mes-compare-back"));
    await userEvent.click(await canvas.findByTestId("mes-candidate-0"));
    await expect(
      await canvas.findByTestId("mes-row-description"),
    ).toBeInTheDocument();

    gate.release();
    await waitFor(() => expect(lateAnswers).toHaveLength(1));
    // Another round trip through the screen, so the late failure has landed by now.
    await userEvent.click(canvas.getByTestId("mes-show-all"));

    await expect(
      await canvas.findByTestId("mes-row-cover"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("mes-row-description-source"),
    ).toHaveTextContent("A revised edition.");
  },
};

export const ClosesOnEscapeFromTheCompareScreen: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByTestId("metadata-search")).toBeNull(),
    );
  },
};

export const ListsOnlyWhatWouldChangeUntilShowAll: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });

    await canvas.findByTestId("mes-row-description");
    const rows = () =>
      [
        ...canvas
          .getByTestId("mes-compare")
          .querySelectorAll(
            '[data-testid="mes-row-cover"], [data-testid="mes-compare-fields"] > *',
          ),
      ].map((el) => el.getAttribute("data-testid"));
    await expect(rows()).toEqual([
      "mes-row-cover",
      "mes-row-title",
      "mes-row-published",
      "mes-row-print-pages",
      "mes-row-genres",
      "mes-row-description",
    ]);
    await expect(canvas.getByTestId("mes-row-title-current")).toHaveTextContent(
      "Aurora Station, Vol. 1",
    );
    await expect(canvas.getByTestId("mes-row-genres-source")).toHaveTextContent(
      "Science fiction, Space opera",
    );

    const showAll = canvas.getByTestId("mes-show-all");
    await expect(showAll).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(showAll);

    await expect(showAll).toHaveAttribute("aria-pressed", "true");
    await expect(showAll).toHaveTextContent("Only differences");
    // Title, Author(s), Publisher, Published, Series, Book #, ISBN-13, ISBN-10, Print Pages, Genres, Description.
    await expect(rows()).toHaveLength(12);
    await expect(canvas.getByTestId("mes-row-author-s-")).toBeInTheDocument();
    await expect(canvas.getByTestId("mes-row-book--")).toBeInTheDocument();
  },
};

export const LeavesOutTheCoverRowWhenTheEditionHasNone: Story = {
  beforeEach({ msw }) {
    msw.use(hydrateHandler({ OL1M: { ...FULL, cover_url: null } }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));
    // The list row still has the search hit's cover, which the full record fills back in.
    await userEvent.click(await canvas.findByTestId("mes-candidate-1"));
    await canvas.findByTestId("mes-row-title");

    await expect(canvas.queryByTestId("mes-row-cover")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("mes-show-all"));
    await expect(canvas.getByTestId("mes-row-cover")).toBeInTheDocument();
    await expect(canvas.getByTestId("mes-row-cover-apply")).toBeDisabled();
  },
};

export const CopiesAFieldIntoTheFormAndUndoesIt: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await canvas.findByTestId("mes-row-title");

    const row = canvas.getByTestId("mes-row-title");
    await expect(row).toHaveAttribute("data-staged", "false");
    await userEvent.click(
      canvas.getByRole("button", { name: "Copy Title from Open Library" }),
    );

    await expect(row).toHaveAttribute("data-staged", "true");
    await expect(formValues(canvas).title).toBe("Aurora Station Volume 1");
    // The row stays, now agreeing with the form, and offers the way back.
    await expect(canvas.getByTestId("mes-row-title-current")).toHaveTextContent(
      "Aurora Station Volume 1",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Undo the change to Title" }),
    );

    await expect(row).toHaveAttribute("data-staged", "false");
    await expect(formValues(canvas).title).toBe("Aurora Station, Vol. 1");
  },
};

export const CopiesAListFieldAsAList: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Copy Genres from Open Library",
      }),
    );

    await expect(formValues(canvas).genres).toEqual([
      "Science fiction",
      "Space opera",
    ]);
    await expect(formValues(canvas).printPages).toBe("320");
  },
};

export const TakesEveryFieldAtOnce: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await canvas.findByTestId("mes-row-title");
    await userEvent.click(canvas.getByTestId("mes-take-all"));

    await expect(formValues(canvas)).toMatchObject({
      title: "Aurora Station Volume 1",
      published: "2022",
      printPages: "352",
      description: "A revised edition.",
      genres: ["Science fiction", "Space opera"],
      // What the source agrees with, or has nothing to say about, is left alone.
      publisher: "Lantern Press",
      tags: ["space opera"],
    });
    await expect(canvas.getByTestId("mes-take-all")).toBeDisabled();
  },
};

export const GoesBackToTheListAndFinishes: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("mes-compare-back"));

    // The results are still there, and so is what was typed.
    await expect(
      await canvas.findByTestId("mes-candidates"),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("Title")).toHaveValue(
      "Aurora Station, Vol. 1",
    );
    await userEvent.click(canvas.getByTestId("mes-candidate-0"));
    await expect(canvas.getByTestId("mes-staged-hint")).toHaveTextContent(
      "Fields aren't saved until you press Save on the form.",
    );
    await userEvent.click(await canvas.findByTestId("mes-done"));

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

export const AppliesTheCoverAtOnceToASavedBook: Story = {
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await expect(
      await canvas.findByTestId("mes-row-cover-note"),
    ).toHaveTextContent("The cover applies immediately");
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Use the cover from Open Library — saves immediately",
      }),
    );

    await expect(await canvas.findByText("Cover updated.")).toBeInTheDocument();
    await expect(fetchedCovers).toEqual(["https://images.example.com/a.jpg"]);
    await expect(canvas.getByLabelText("Cover")).toHaveTextContent("replaced");
    await expect(currentCoverSrc(canvas)).toMatch(/\?v=1$/);
  },
};

export const SaysWhyTheCoverWasRefused: Story = {
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(BOOK, { refuse: "that host is private" }));
  },
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await userEvent.click(await canvas.findByTestId("mes-row-cover-apply"));

    await expect(
      await canvas.findByText(
        "Couldn't apply that cover: that host is private",
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("Cover")).toHaveTextContent("scanned");
    await expect(currentCoverSrc(canvas)).not.toContain("?v=");
    await expect(canvas.getByTestId("mes-row-cover-apply")).toBeEnabled();
  },
};

export const StagesTheCoverUnderReview: Story = {
  render: () => <Picker stagedCover />,
  play: async ({ canvas, userEvent }) => {
    await openCompare({ canvas, userEvent });
    await expect(
      await canvas.findByTestId("mes-row-cover-note"),
    ).toHaveTextContent("The cover is saved with the book when you add it");
    await userEvent.click(
      canvas.getByRole("button", { name: "Use the cover from Open Library" }),
    );

    await expect(await canvas.findByText("Cover staged.")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Cover")).toHaveTextContent(
      "staged:url",
    );
    await expect(fetchedCovers).toEqual([]);
  },
};
