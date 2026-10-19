import type { Meta, StoryObj } from "@storybook/react-vite";
import { useForm } from "react-hook-form";
import { expect, waitFor } from "storybook/test";
import { formFromBook, hasProviderQuery } from "../../api";
import type {
  EditionSearchRequest,
  EditionSearchResponse,
} from "../../api/generated/schemas";
import { storyClient } from "../../testing/AppHarness";
import { failing } from "../../testing/handlers";
import {
  anEditableWireBook,
  aProviderEdition,
  editionSearchHandler,
  providersHandler,
} from "../../testing/metadataHandlers";
import { EditionPicker } from "./EditionPicker";

const BOOK = anEditableWireBook();
const ANSWERED = { kind: "answered", count: 3 } as const;

const FOUND: EditionSearchResponse = {
  editions: [
    aProviderEdition({
      source: "google_books",
      provider_ref: "gb-study",
      title: "Aurora Station: A Study Guide",
      authors: ["Gale"],
      isbn13: "9781410336088",
      year: null,
      publisher: null,
    }),
    aProviderEdition({
      source: "hardcover",
      provider_ref: "hc-work",
      title: "Aurora Station",
      authors: [],
      year: null,
      publisher: null,
      isbn13: null,
    }),
    aProviderEdition({ cover_url: "https://images.example.com/a.jpg" }),
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
const providerCalls = { count: 0 };

function Picker() {
  const form = useForm({ defaultValues: formFromBook(BOOK) });
  return <EditionPicker form={form} />;
}

const meta = {
  title: "Pages/BookEdit/EditionPicker",
  component: Picker,
  beforeEach({ msw }) {
    searched.length = 0;
    providerCalls.count = 0;
    msw.use(
      providersHandler(true, providerCalls),
      editionSearchHandler(FOUND, { searched }),
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
      "Aurora Station, Vol. 1",
      "Aurora Station",
      "Aurora Station: A Study Guide",
    ]);
    await expect(
      canvas.getByTestId("mes-candidate-0-imprint"),
    ).toHaveTextContent("2021 · Lantern Press · 9780134685991");
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
