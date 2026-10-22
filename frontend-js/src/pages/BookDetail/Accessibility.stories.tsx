import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetAlignmentMockHandler200,
  getGetBookHouseholdMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetProgressMockHandler200,
  getGetSuggestionsMockHandler200,
} from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import {
  bookDetailHandlers,
  highlightsHandlers,
  journalHandlers,
  physicalHandlers,
  readStatusHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireBook,
  aWireBookHouseholdReader,
  aWireCopy,
  aWireFile,
  aWireHighlight,
  aWireInsights,
  aWireJournalEntry,
  aWireOtherReview,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
  aWireReview,
  aWireSuggestion,
  aWireWishlist,
  WIRE_ADA,
} from "../../testing/wire";
import { BookDetail } from "./BookDetail";

const EPUB = aWireFile({ id: 11, format: "EPUB" });
const AUDIO = aWireFile({
  id: 21,
  format: "M4B",
  filename: "a.m4b",
  size_bytes: 512_000_000,
});

const RICH = aWireBook({
  series_id: 4,
  formats: ["EPUB", "M4B"],
  book_files: [EPUB, AUDIO],
  genres: ["Science fiction"],
  subjects: ["Space opera", "First contact"],
  description: `<p>${"A station at the edge of the map hears something answer. ".repeat(6)}</p>`,
});
const UUID = RICH.unique_identifier;

const LONG_ENTRY =
  "Darrow's first night in the Institute reframes everything before it. The caste colours stop being worldbuilding and start being the plot. ".repeat(
    3,
  );

/** Every answer the page can show, so each tab has all of its text on screen. */
const richHandlers = (book = RICH) => [
  ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
  ...reviewHandlers({
    mine: aWireReview({
      stars: 4,
      body_md: "Better on the second read.",
      body_html: "<p>Better on the second read.</p>",
      notes_md: "Lend to Sam.",
      notes_html: "<p>Lend to Sam.</p>",
    }),
    others: [
      aWireOtherReview({
        stars: 4.5,
        body_md: "Quietly devastating.",
        body_html: "<p>Quietly devastating.</p>",
      }),
      aWireOtherReview({ user_id: 8, username: "linus", stars: 3 }),
    ],
  }),
  ...highlightsHandlers([
    aWireHighlight({ id: 1, note: "Remember this one." }),
  ]),
  ...journalHandlers(
    [
      aWireJournalEntry({ id: 1, progress: 42 }),
      aWireJournalEntry({
        id: 2,
        author_id: 7,
        author_name: "grace",
        body_md: LONG_ENTRY,
        body_html: `<p>${LONG_ENTRY}</p>`,
      }),
      aWireJournalEntry({ id: 3, status: "draft", body_md: "Half a thought" }),
    ],
    WIRE_ADA.id,
  ),
  ...physicalHandlers({ copies: [aWireCopy()] }),
  getGetProgressMockHandler200(
    aWireProgress(aWirePosition({ progress_percent: 45 })),
  ),
  getGetAlignmentMockHandler200(
    aWireAlignment({
      ebook: { total_chars: 1000, chapters: [] },
      audio_files: [
        {
          book_file_id: 21,
          duration_seconds: 10_800,
          chapter_starts: [],
          label: "a.m4b",
        },
      ],
      listening: {
        book_file_id: 21,
        seconds: 5400,
        client_updated_at: nowSecs(),
      },
      link: {
        confirmed_at: nowSecs() - 3 * 86_400,
        stale: false,
        follow: true,
        mode: "sequence",
      },
    }),
  ),
  getGetBookInsightsMockHandler200(aWireInsights()),
  getGetBookHouseholdMockHandler200([aWireBookHouseholdReader()]),
  getGetSuggestionsMockHandler200({
    status: "ready",
    items: [1, 2, 3, 4, 5, 6].map((id) =>
      aWireSuggestion({ hardcover_id: id, title: `Suggestion ${id}` }),
    ),
  }),
  ...bookDetailHandlers(book),
];

const meta = {
  title: "Pages/BookDetail/Accessibility",
  component: BookDetail,
  parameters: { path: `/books/${UUID}` },
  render: () => (
    <Routes>
      <Route path="/books/:uuid" element={<BookDetail />} />
    </Routes>
  ),
  beforeEach({ msw }) {
    msw.use(...richHandlers());
  },
} satisfies Meta<typeof BookDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const PHONE = {
  phone: { name: "Phone", styles: { width: "390px", height: "844px" } },
};
const phone = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { viewport: { options: PHONE } },
} as const;

type Canvas = ReturnType<typeof within>;
type User = { click: (el: Element) => Promise<void> };

const openTab = async (canvas: Canvas, userEvent: User, name: string) => {
  await userEvent.click(await canvas.findByRole("tab", { name }));
  await waitFor(() =>
    expect(canvas.getByRole("tab", { name })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  return within(canvas.getByRole("tabpanel", { name }));
};

/** Every visible piece of text under `root` set smaller than `min` pixels; a generated cover's lettering is artwork, scaled with the cover. */
function smallText(root: HTMLElement, min = 13) {
  const found = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const element = node.parentElement;
    if (!text || !element?.checkVisibility() || element.closest(".cover"))
      continue;
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    if (size < min) {
      found.add(
        `${element.tagName.toLowerCase()}.${element.className} ${size}px "${text.slice(0, 20)}"`,
      );
    }
  }
  return [...found];
}

/** The sRGB of any CSS colour, read back from a pixel so `oklch()` and `color-mix()` are covered. */
function rgbOf(css: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort(
    (x, y) => y - x,
  );
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** What `expression` (a colour, or a `var()` of one) computes to inside `scope`. */
function colorIn(scope: Element, expression: string) {
  const probe = document.createElement("span");
  probe.style.color = expression;
  scope.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
}

const sizeOf = (element: Element) => element.getBoundingClientRect();

export const TextIsNeverUnder13px: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByRole("heading", { level: 1 });
    await canvas.findByRole("heading", { name: "Your reading" });
    await waitFor(() =>
      expect(
        canvas.queryByText(/Gathering|Tallying|Finding|Checking your shelves/),
      ).toBeNull(),
    );
    const found = [...smallText(canvasElement)];

    for (const name of ["Reviews", "Highlights & Journal", "Files & Details"]) {
      const panel = await openTab(canvas, userEvent, name);
      await panel.findAllByRole("heading");
      await waitFor(() =>
        expect(
          canvas.queryByText(
            /Gathering|Tallying|Finding|Checking your shelves/,
          ),
        ).toBeNull(),
      );
      found.push(...smallText(canvasElement));
    }

    await expect([...new Set(found)]).toEqual([]);
  },
};

export const AWishlistEyebrowIsReadable: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...physicalHandlers({ wishlist: aWireWishlist() }),
      ...bookDetailHandlers(aWireBook({ formats: [] })),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByText(/On your wishlist/);

    await expect(smallText(canvasElement)).toEqual([]);
  },
};

export const StatusMenuNoteIsReadable: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(
        aWireReadStatus({
          status: "finished",
          finished_at: nowSecs() - 86_400,
        }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const pill = await canvas.findByRole("button", {
      name: "Read status: Finished",
    });
    await waitFor(() => expect(pill).toBeEnabled());
    await userEvent.click(pill);

    const menu = await canvas.findByRole("menu", { name: "Read status" });
    const note = menu.querySelector(".shd-menu-note") as HTMLElement;
    await expect(smallText(menu)).toEqual([]);
    // Muted, but still readable against the menu it sits on.
    await expect(
      contrast(
        getComputedStyle(note).color,
        getComputedStyle(menu).backgroundColor,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  },
};

export const StageMenuFocusShowsARing: Story = {
  play: async ({ canvas, userEvent }) => {
    const pill = await canvas.findByRole("button", {
      name: "Read status: Reading",
    });
    await waitFor(() => expect(pill).toBeEnabled());
    pill.focus();

    await userEvent.keyboard("{Enter}");

    // The checked item takes focus, and its ring is a line, not a change of background.
    const checked = await canvas.findByRole("menuitemradio", {
      name: "Reading",
    });
    await waitFor(() => expect(checked).toHaveFocus());
    const style = getComputedStyle(checked);
    await expect(style.outlineStyle).toBe("solid");
    await expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(
      2,
    );
  },
};

export const StageDangerReadsInLight: Story = {
  globals: { theme: "light" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "More actions" }),
    );

    const item = await canvas.findByRole("menuitem", { name: "Delete files…" });
    const menu = item.closest(".shd-menu") as HTMLElement;
    const stage = canvasElement.querySelector(".bp-stage") as HTMLElement;
    // The stage is dark in every theme, so its red is the dark theme's, not the light theme's deep one.
    await expect(getComputedStyle(item).color).toBe(
      colorIn(stage, "oklch(0.72 0.16 25)"),
    );
    await expect(
      contrast(
        getComputedStyle(item).color,
        getComputedStyle(menu).backgroundColor,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  },
};

export const StarHalvesAreAtLeast24pxWide: Story = {
  play: async ({ canvas }) => {
    const half = await canvas.findByRole("button", { name: "Rate 3.5 stars" });

    await expect(sizeOf(half).width).toBeGreaterThanOrEqual(24);
    await expect(sizeOf(half).height).toBeGreaterThanOrEqual(44);
  },
};

/** The `color` a stylesheet gives `selector` exactly, found by rule: a story's pointer is synthetic, so `:hover` never matches. */
function declaredColor(selector: string) {
  const search = (rules: CSSRuleList): string | undefined => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
        return rule.style.color;
      }
      if ("cssRules" in rule) {
        const inner = search((rule as CSSGroupingRule).cssRules);
        if (inner) return inner;
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      const found = search(sheet.cssRules);
      if (found) return found;
    } catch {
      // A sheet from another origin is closed to scripts, and is not the app's.
    }
  }
}

export const ReviewStarsHoverInInkOffTheStage: Story = {
  globals: { theme: "light" },
  play: async ({ canvas, userEvent }) => {
    const reviews = await openTab(canvas, userEvent, "Reviews");
    const stars = (await reviews.findByTestId("review-stars")) as HTMLElement;

    // Off the stage a pale accent would vanish on a light page, so hover darkens to ink.
    await expect(stars.closest(".bp-stage")).toBeNull();
    await expect(declaredColor(".bd-stars-interactive:hover")).toBe(
      "var(--ink-1)",
    );
    // The accent is for the stage's own dark ground alone.
    await expect(declaredColor(".bp-stage .bd-stars-interactive:hover")).toBe(
      "var(--bp-accent-text)",
    );
  },
};

export const QuoteBackActionsRingInCream: Story = {
  globals: { theme: "light" },
  play: async ({ canvas, userEvent }) => {
    const journal = await openTab(canvas, userEvent, "Highlights & Journal");
    const make = await journal.findByRole("button", {
      name: "Make quote card",
    });
    make.focus();

    await userEvent.keyboard("{Enter}");

    const back = await journal.findByRole("button", { name: "Flip back" });
    await waitFor(() => expect(back).toHaveFocus());
    await expect(getComputedStyle(back).outlineColor).toBe(
      colorIn(back, "#f3ebdd"),
    );
  },
};

const ACCENTS = [
  ["a mid red", "oklch(0.555 0.153 28.4)"],
  ["a pale yellow", "oklch(0.86 0.16 95)"],
  ["a bright green", "oklch(0.72 0.2 142)"],
] as const;

export const AccentFillsCarryWhiteTextWhateverTheCover: Story = {
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { level: 1 });
    const root = canvasElement.querySelector(".bp-root") as HTMLElement;
    const fill = canvasElement.querySelector(
      ".bp-continue-fill",
    ) as HTMLElement;

    for (const [, accent] of ACCENTS) {
      root.style.setProperty("--accent", accent);
      const token = colorIn(root, "var(--bp-accent-fill)");
      await expect(contrast("#fff", token)).toBeGreaterThanOrEqual(4.5);
      // The progress fill under Continue is drawn in that same token.
      await expect(getComputedStyle(fill).backgroundImage).toContain(token);
    }
    // And on the Black theme's own near-white accent, with no cover colour at all.
    root.style.removeProperty("--accent");
    await expect(
      contrast("#fff", colorIn(root, "var(--bp-accent-fill)")),
    ).toBeGreaterThanOrEqual(4.5);
  },
};

export const SuggestionsScrollWithAThinBarOnAFinePointer: Story = {
  play: async ({ canvasElement }) => {
    const row = await waitFor(() => {
      const found = canvasElement.querySelector(".bp-suggest-row");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    await expect(getComputedStyle(row).scrollbarWidth).toBe("thin");
  },
};

export const TouchTargetsAtPhoneWidth: Story = {
  ...phone,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const go = await canvas.findByRole("button", {
      name: /^See grace.s review/,
    });
    await expect(
      Math.min(sizeOf(go).width, sizeOf(go).height),
    ).toBeGreaterThanOrEqual(44);
    const removers = await canvas.findAllByRole("button", {
      name: /^Remove (genre|tag) /,
    });
    for (const remove of removers) {
      await expect(
        Math.min(sizeOf(remove).width, sizeOf(remove).height),
      ).toBeGreaterThanOrEqual(44);
    }

    const journal = await openTab(canvas, userEvent, "Highlights & Journal");
    const more = await journal.findByRole("button", { name: "Read more" });
    await expect(sizeOf(more).height).toBeGreaterThanOrEqual(44);
    const actions = canvasElement.querySelectorAll(".bp-entry-actions .btn");
    await expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      await expect(sizeOf(action).height).toBeGreaterThanOrEqual(44);
    }

    const files = await openTab(canvas, userEvent, "Files & Details");
    const add = await files.findByRole("link", { name: "Add publisher" });
    await expect(sizeOf(add).height).toBeGreaterThanOrEqual(44);
    const synclinks = await waitFor(() => {
      const found = canvasElement.querySelectorAll(".bdmq-synclink");
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const link of synclinks) {
      await expect(sizeOf(link).height).toBeGreaterThanOrEqual(44);
    }
  },
};

export const ALongTitleAndANameStayInsideAPhone: Story = {
  ...phone,
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({
        mine: aWireReview({ stars: 4 }),
        others: [
          aWireOtherReview({
            stars: 4,
            username: "Bartholomew-Fitzgerald-Montgomery-Throckmorton",
          }),
        ],
      }),
      ...bookDetailHandlers(
        aWireBook({
          title:
            "Pneumonoultramicroscopicsilicovolcanoconiosis and other long words",
          formats: ["EPUB"],
          book_files: [EPUB],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const title = await canvas.findByRole("heading", { level: 1 });
    const list = await canvas.findByRole("list", { name: "Household ratings" });

    await expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1);
    const row = list.querySelector(".bp-reader") as HTMLElement;
    await expect(sizeOf(row).right).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const FinishedNextRingFollowsItsEdgesOnAPhone: Story = {
  ...phone,
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(
        aWireReadStatus({
          status: "finished",
          finished_at: nowSecs() - 86_400,
        }),
      ),
      // Unrated, so the card offers "Leave a review" whatever the series holds.
      ...reviewHandlers({}),
    );
  },
  play: async ({ canvasElement }) => {
    const next = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>(".bp-finish-next");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    next.focus();

    // Stacked under the card, the ring is not rounded off by the corner the desktop layout gives it.
    await expect(getComputedStyle(next).outlineStyle).toBe("solid");
    await expect(getComputedStyle(next).borderRadius).toBe("0px");
    await expect(getComputedStyle(next).outlineOffset).toBe("2px");
  },
};
