import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetSeriesInProgressMockHandler200,
  getGetShelfMockHandler404,
} from "../../api/generated/omnibus.msw";
import type { SeriesInProgress } from "../../api/generated/schemas";
import {
  expectInvalidated,
  seedQueries,
  storyClient,
} from "../../testing/AppHarness";
import {
  failing,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
  recentProgressHandler,
  type SeriesHomeWrite,
  seriesHomeHandlers,
  shelvesHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireBookReading,
  aWireLibrary,
  aWireResumePoint,
  aWireSeries,
  aWireSeriesInProgress,
  uuidOf,
} from "../../testing/wire";
import { Library } from "./Library";

const meta = {
  title: "Pages/Library/Series in progress",
  component: Library,
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(3), 10),
      shelvesHandler([]),
      getGetShelfMockHandler404(),
    );
    for (const key of [
      `omnibus.view_prefs::${LIBRARY_PATH}`,
      "omnibus.view_prefs.last_library",
      "omnibus.landing_shelf",
    ]) {
      localStorage.removeItem(key);
    }
  },
} satisfies Meta<typeof Library>;

export default meta;
type Story = StoryObj<typeof meta>;

const RESUME = aWireResumePoint({ progress_percent: 42 });

/** A series of `count` volumes whose first `finished` are done and next one is `finished + 1`. */
function aRow(id: number, name: string, count: number, finished: number) {
  const volume = (n: number) =>
    aWireBook({
      id: id * 100 + n,
      title: `${name} ${n}`,
      unique_identifier: uuidOf(id * 100 + n),
      series: name,
      series_index: String(n),
      series_id: id,
      formats: ["EPUB"],
    });
  const books = Array.from({ length: count }, (_, i) => volume(i + 1));
  const reading = Array.from({ length: finished }, (_, i) =>
    aWireBookReading({
      book_uuid: uuidOf(id * 100 + i + 1),
      status: "finished",
      percent: 100,
    }),
  );
  return aWireSeriesInProgress({
    id,
    name,
    book_count: count,
    books,
    reading,
    next_book_uuid: uuidOf(id * 100 + finished + 1),
  });
}

const SAGA = aRow(7, "Saga", 5, 2);
const PIONEERS = aRow(8, "Pioneers", 3, 0);
const SAGA_DETAIL = aWireSeries({
  id: 7,
  name: "Saga",
  book_count: 5,
  books: SAGA.books,
  reading: SAGA.reading,
});

/** The row for `series` whose next book is being read, 42% in. */
function reading(series: SeriesInProgress): SeriesInProgress {
  return {
    ...series,
    reading: [
      ...(series.reading ?? []),
      aWireBookReading({
        book_uuid: series.next_book_uuid,
        status: "reading",
        percent: 42,
      }),
    ],
  };
}

/** The computed `font-family` of `value` (a `var()` of a token) where `host` is drawn. */
function fontFamilyOf(value: string, host: HTMLElement) {
  const probe = document.createElement("span");
  probe.style.fontFamily = value;
  host.append(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family;
}

const panel = (canvas: ReturnType<typeof within>) =>
  canvas.findByRole("region", { name: "Series in progress" });

const fan = (canvas: ReturnType<typeof within>) =>
  canvas.findByRole("region", { name: "Continue reading" });

export const FanAndList: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      getGetSeriesInProgressMockHandler200([reading(SAGA), PIONEERS]),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const list = await panel(canvas);
    const stack = await fan(canvas);

    await expect(list.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      stack.getBoundingClientRect().right - 1,
    );
    await expect(canvasElement.querySelector(".sip-hero--pair")).not.toBeNull();
    const rows = within(list).getAllByTestId("sip-row");
    await expect(rows).toHaveLength(2);
    const heading = within(list).getByRole("heading", {
      name: "Series in progress",
    });
    await expect(within(list).getByText("2 series")).toBeInTheDocument();
    await expect(getComputedStyle(heading).fontFamily).toBe(
      fontFamilyOf("var(--sans)", list),
    );
    await expect(getComputedStyle(heading).textTransform).toBe("none");
    await expect(getComputedStyle(heading).fontWeight).toBe("600");
    await expect(getComputedStyle(heading).fontSize).toBe("15px");
    await expect(getComputedStyle(heading).letterSpacing).toBe("normal");
    const total = within(list).getByText("2 series");
    await expect(getComputedStyle(total).fontFamily).toBe(
      fontFamilyOf("var(--mono)", list),
    );
    await expect(getComputedStyle(total).textTransform).toBe("uppercase");
    const [saga, pioneers] = rows;
    if (!saga || !pioneers) throw new Error("the rows are missing");

    const name = within(saga).getByRole("link", { name: "Saga" });
    await expect(name).toHaveAttribute("href", "/series/7");
    await expect(saga).toHaveTextContent("Up next · Book 3 · Saga 3 · 42%");
    await expect(
      within(saga).getByRole("img", { name: "2 of 5 finished" }),
    ).toBeInTheDocument();
    await expect(saga).toHaveTextContent("2 of 5");
    const leaves = saga.querySelectorAll(".ss-leaf");
    await expect(leaves).toHaveLength(3);
    await expect(
      leaves[0]?.querySelector("img")?.getAttribute("src"),
    ).toContain(uuidOf(703));
    await expect(within(saga).getByTestId("sip-go")).toHaveTextContent(
      "Resume",
    );
    await expect(within(saga).getByTestId("sip-go")).toHaveAttribute(
      "href",
      `/read/${uuidOf(703)}`,
    );

    await expect(
      within(pioneers).getByRole("link", { name: "Pioneers" }),
    ).toBeInTheDocument();
    await expect(pioneers).toHaveTextContent("Up next · Book 1 · Pioneers 1");
    await expect(within(pioneers).getByTestId("sip-go")).toHaveTextContent(
      "Start",
    );
    await expect(within(pioneers).getByTestId("sip-go")).toHaveAttribute(
      "href",
      `/read/${uuidOf(801)}`,
    );
  },
};

export const ManyRows: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      getGetSeriesInProgressMockHandler200(
        Array.from({ length: 9 }, (_, i) =>
          aRow(20 + i, `Series ${i + 1}`, 4, 1),
        ),
      ),
    );
  },
  play: async ({ canvas }) => {
    const list = await panel(canvas);
    const stack = await fan(canvas);

    await expect(list.getBoundingClientRect().height).toBeLessThanOrEqual(
      stack.getBoundingClientRect().height + 1,
    );
    const scroller = list.querySelector(".sip-list");
    if (!(scroller instanceof HTMLElement)) throw new Error("no list");
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    await expect(getComputedStyle(scroller).maskImage).not.toBe("none");
  },
};

export const ListAlone: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([]),
      getGetSeriesInProgressMockHandler200(
        Array.from({ length: 9 }, (_, i) =>
          aRow(20 + i, `Series ${i + 1}`, 4, 1),
        ),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const list = await panel(canvas);

    await expect(
      canvas.queryByRole("region", { name: "Continue reading" }),
    ).toBeNull();
    const hero = canvasElement.querySelector(".sip-hero--solo");
    if (!hero) throw new Error("no solo hero");
    const [h, p] = [hero.getBoundingClientRect(), list.getBoundingClientRect()];
    await expect(
      Math.abs((h.left + h.right) / 2 - (p.left + p.right) / 2),
    ).toBeLessThanOrEqual(1);
    await expect(p.height).toBeLessThanOrEqual(381);
  },
};

export const Neither: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([]),
      getGetSeriesInProgressMockHandler200([]),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { name: "Your Library" });
    await waitFor(() =>
      expect(canvasElement.querySelector(".sip-panel-pending")).toBeNull(),
    );

    await expect(canvas.queryByTestId("series-in-progress")).toBeNull();
    await expect(canvas.queryByTestId("sip-hero")).toBeNull();
  },
};

export const Phone: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: {
    viewport: {
      options: {
        phone: { name: "Phone", styles: { width: "390px", height: "844px" } },
      },
    },
  },
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      getGetSeriesInProgressMockHandler200([SAGA, PIONEERS]),
    );
  },
  play: async ({ canvas }) => {
    const list = await panel(canvas);
    const stack = await fan(canvas);

    await expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      stack.getBoundingClientRect().bottom - 1,
    );
  },
};

const NARROW_DESKTOP = {
  options: {
    narrowDesktop: {
      name: "Narrow desktop",
      styles: { width: "900px", height: "800px" },
    },
  },
};

export const StacksBelowTheFanOnANarrowDesktop: Story = {
  globals: { viewport: { value: "narrowDesktop", isRotated: false } },
  parameters: { viewport: NARROW_DESKTOP },
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      getGetSeriesInProgressMockHandler200([SAGA, PIONEERS]),
    );
  },
  play: async ({ canvas }) => {
    const list = await panel(canvas);
    const stack = await fan(canvas);

    await expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      stack.getBoundingClientRect().bottom - 1,
    );
  },
};

export const FanAloneKeepsItsFullWidth: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      getGetSeriesInProgressMockHandler200([]),
    );
  },
  play: async ({ canvas }) => {
    const stack = await fan(canvas);

    await expect(stack.getBoundingClientRect().width).toBeGreaterThan(520);
  },
};

export const WhileLoading: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      hanging("/api/series/in-progress"),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await fan(canvas);

    await expect(
      canvasElement.querySelector(".sip-panel-pending"),
    ).not.toBeNull();
    await expect(canvas.queryByTestId("series-in-progress")).toBeNull();
  },
};

export const ListFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      recentProgressHandler([RESUME]),
      failing("get", "/api/series/in-progress", 500),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await fan(canvas);
    await waitFor(() =>
      expect(canvasElement.querySelector(".sip-panel-pending")).toBeNull(),
    );

    await expect(canvas.queryByTestId("series-in-progress")).toBeNull();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

let writes: SeriesHomeWrite[] = [];

/** The `opacity` the stylesheets give `selector`, within `media` when named: a story's pointer and keys are synthetic, so `:hover` and `:focus-visible` never match. */
function declaredOpacity(selector: string, media: string | null = null) {
  const search = (
    rules: CSSRuleList,
    within: string | null,
  ): string | undefined => {
    for (const rule of rules) {
      if (
        rule instanceof CSSStyleRule &&
        within === media &&
        rule.selectorText.split(",").some((part) => part.trim() === selector)
      ) {
        return rule.style.opacity;
      }
      if (rule instanceof CSSMediaRule) {
        const found = search(rule.cssRules, rule.conditionText);
        if (found) return found;
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      const found = search(sheet.cssRules, null);
      if (found) return found;
    } catch {
      // A sheet from another origin is closed to scripts, and is not the app's.
    }
  }
}

/** Presses Tab until `target` has the keyboard. */
async function tabTo(
  target: HTMLElement,
  tab: () => Promise<void>,
): Promise<void> {
  for (let i = 0; i < 40 && document.activeElement !== target; i++) await tab();
}

export const HideFromRow: Story = {
  beforeEach({ msw }) {
    const home = seriesHomeHandlers({
      rows: [SAGA, PIONEERS],
      detail: SAGA_DETAIL,
    });
    writes = home.writes;
    msw.use(recentProgressHandler([RESUME]), ...home.handlers);
  },
  play: async ({ canvas, userEvent }) => {
    const list = await panel(canvas);
    const [saga] = within(list).getAllByTestId("sip-row");
    if (!saga) throw new Error("the row is missing");
    const hide = within(saga).getByRole("button", {
      name: "Hide Saga from home",
    });
    seedQueries([["series", 7]]);

    await expect(hide).not.toBeVisible();
    await tabTo(hide, () => userEvent.tab());
    await expect(hide).toHaveFocus();
    await expect(
      declaredOpacity(".sip-row:hover .sip-hide", "(hover: hover)"),
    ).toBe("1");
    await expect(declaredOpacity(".sip-hide:focus-visible")).toBe("1");
    await expect(declaredOpacity(".sip-hide", "(hover: none)")).toBe("1");

    await userEvent.click(hide);
    const dialog = await canvas.findByRole("dialog", {
      name: "Hide Saga from home?",
    });
    await expect(dialog).toHaveTextContent(
      "It stays in your library and comes back here when you start another book in it.",
    );
    await userEvent.click(canvas.getByTestId("series-hide-cancel"));
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await expect(within(list).getAllByTestId("sip-row")).toHaveLength(2);
    await expect(writes).toEqual([]);

    await userEvent.click(hide);
    await userEvent.click(await canvas.findByTestId("series-hide-confirm"));

    await waitFor(() =>
      expect(within(list).getAllByTestId("sip-row")).toHaveLength(1),
    );
    await expect(within(list).queryByRole("link", { name: "Saga" })).toBeNull();
    await expect(writes).toEqual([{ op: "hide", id: 7 }]);
    await expect(
      storyClient().getQueryData(["series", "in-progress"]),
    ).toHaveLength(1);
    await expectInvalidated([["series", 7]]);
    // The hidden row's ✕ is gone; focus moves on rather than falling to the page.
    await waitFor(() =>
      expect(
        within(list).getByRole("button", { name: "Hide Pioneers from home" }),
      ).toHaveFocus(),
    );
  },
};

export const HideFails: Story = {
  beforeEach({ msw }) {
    const home = seriesHomeHandlers({ rows: [SAGA, PIONEERS] });
    msw.use(
      recentProgressHandler([RESUME]),
      failing("put", "/api/series/:id/hide", 500),
      ...home.handlers,
    );
  },
  play: async ({ canvas, userEvent }) => {
    const list = await panel(canvas);

    await userEvent.click(
      within(list).getByRole("button", { name: "Hide Saga from home" }),
    );
    await userEvent.click(await canvas.findByTestId("series-hide-confirm"));

    await expect(
      await canvas.findByText("Couldn't hide Saga: failed with 500"),
    ).toBeInTheDocument();
    await expect(within(list).getAllByTestId("sip-row")).toHaveLength(2);
    await expect(canvas.queryByRole("dialog")).toBeNull();
  },
};
