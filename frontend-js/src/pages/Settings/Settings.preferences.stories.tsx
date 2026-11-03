import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import type { FilterClause } from "../../api";
import {
  deferred,
  filterOptionHandlers,
  shelvesHandler,
} from "../../testing/handlers";
import { SettingsRoutes } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";
import { aWireBook, aWireStack, uuidOf, WIRE_ADA } from "../../testing/wire";

let server: SettingsServer;
let release = () => {};

const meta = {
  title: "Pages/Settings/Preferences",
  component: SettingsRoutes,
  args: { path: "/settings?section=preferences" },
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    server = aSettingsServer();
    msw.use(...settingsHandlers(server));
  },
} satisfies Meta<typeof SettingsRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

const refuse = (route: string, text: string) =>
  http.post(
    `/api/account/${route}`,
    () => new HttpResponse(text, { status: 422 }),
  );

export const ShowsTheFiveGroups: Story = {
  play: async ({ canvas }) => {
    for (const id of [
      "preferences-appearance",
      "preferences-library",
      "preferences-stats",
      "preferences-book-page",
      "preferences-privacy",
    ]) {
      await expect(await canvas.findByTestId(id)).toBeVisible();
    }
    await expect(
      canvas.getByRole("switch", { name: "Stack series" }),
    ).not.toBeChecked();
    await expect(
      canvas.getByRole("switch", { name: "Scroll stops" }),
    ).not.toBeChecked();
    await expect(
      canvas.getByRole("switch", { name: "Share stats with household" }),
    ).toBeChecked();
    await expect(
      canvas.getByRole("group", { name: "Hidden formats" }),
    ).toBeVisible();
  },
};

export const SavesStackSeries: Story = {
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", { name: "Stack series" });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(canvas.getByTestId("stack-series-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(toggle).toBeChecked();
  },
};

export const SavesScrollStops: Story = {
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", { name: "Scroll stops" });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(canvas.getByTestId("scroll-stops-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(toggle).toBeChecked();
  },
};

export const SavesShareStatsOff: Story = {
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Share stats with household",
    });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(canvas.getByTestId("share-stats-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(toggle).not.toBeChecked();
  },
};

export const FlipsARefusedSwitchBack: Story = {
  beforeEach({ msw }) {
    msw.use(refuse("stack-series", "not allowed"));
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", { name: "Stack series" });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(canvas.getByTestId("stack-series-status")).toHaveTextContent(
        "Couldn’t save: not allowed",
      ),
    );
    await expect(toggle).not.toBeChecked();
  },
};

export const SavesAHiddenFormat: Story = {
  play: async ({ canvas, userEvent }) => {
    const m4b = await canvas.findByRole("checkbox", { name: "M4B" });
    await userEvent.click(m4b);

    await waitFor(() =>
      expect(canvas.getByTestId("hidden-formats-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(m4b).toBeChecked();
  },
};

const WITH_UNKNOWN = { ...WIRE_ADA, hidden_formats: ["djvu", "pdf"] };

export const ShowsAgainAFormatTheListDoesNotKnow: Story = {
  parameters: { user: WITH_UNKNOWN },
  beforeEach({ msw }) {
    msw.use(...settingsHandlers(aSettingsServer({ user: WITH_UNKNOWN })));
  },
  play: async ({ canvas, userEvent }) => {
    const djvu = await canvas.findByRole("checkbox", { name: "DJVU" });
    await expect(djvu).toBeChecked();
    await userEvent.click(djvu);

    await waitFor(() =>
      expect(canvas.queryByRole("checkbox", { name: "DJVU" })).toBeNull(),
    );
    await expect(canvas.getByRole("checkbox", { name: "PDF" })).toBeChecked();
  },
};

export const RestoresTheHiddenFormatsWhenRefused: Story = {
  beforeEach({ msw }) {
    msw.use(refuse("hidden-formats", "format name is invalid"));
  },
  play: async ({ canvas, userEvent }) => {
    const epub = await canvas.findByRole("checkbox", { name: "EPUB" });
    await userEvent.click(epub);

    await waitFor(() =>
      expect(canvas.getByTestId("hidden-formats-status")).toHaveTextContent(
        "Couldn’t save: format name is invalid",
      ),
    );
    await expect(epub).not.toBeChecked();
  },
};

export const PressesATheme: Story = {
  play: async ({ canvas, userEvent }) => {
    const sepia = await canvas.findByRole("button", { name: "Sepia" });
    await userEvent.click(sepia);

    await expect(sepia).toHaveAttribute("aria-pressed", "true");
  },
};

export const KeepsAFormatCheckedWhileAnotherPreferenceSaves: Story = {
  beforeEach({ msw }) {
    const gate = deferred();
    release = gate.release;
    msw.use(
      // Answers nothing, so the fake route behind it saves once the gate opens.
      http.post("/api/account/hidden-formats", async () => {
        await gate.promise;
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const epub = await canvas.findByRole("checkbox", { name: "EPUB" });
    const pdf = canvas.getByRole("checkbox", { name: "PDF" });
    await userEvent.click(epub);
    await expect(epub).toBeChecked();
    await waitFor(() => expect(pdf).toBeDisabled());
    await userEvent.click(
      canvas.getByRole("switch", { name: "Share stats with household" }),
    );

    // The switch's save lands while the format save is still held.
    await waitFor(() =>
      expect(canvas.getByTestId("share-stats-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(epub).toBeChecked();

    release();
    await waitFor(() =>
      expect(canvas.getByTestId("hidden-formats-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(epub).toBeChecked();
    await expect(pdf).toBeEnabled();
    await expect(server.user.hidden_formats).toEqual(["epub"]);
  },
};

const SPORTS: FilterClause = {
  field: "tag",
  mode: "include",
  values: ["Sports"],
};
const WITH_RULE = { ...WIRE_ADA, stats_exclusions: { clauses: [SPORTS] } };

// Three tagged books: two in one series (a stack at its lead's slot) and one loose.
const tagged = (n: number) =>
  aWireBook({
    id: n,
    title: `Aurora Station, Vol. ${n}`,
    subjects: ["Sports"],
    unique_identifier: uuidOf(n),
  });
const PREVIEW_PAGE = {
  books: [tagged(1), tagged(3)],
  path: "/library",
  stacks: [
    aWireStack({
      lead_uuid: uuidOf(1),
      name: "Aurora Station",
      members: [tagged(1), tagged(2)],
    }),
  ],
};
const previews: URLSearchParams[] = [];
let posts = 0;

// What the dialog's FilterBar reads to offer shelves and tags.
const filterSupport = [
  shelvesHandler([]),
  ...filterOptionHandlers({ tags: [{ name: "Sports", count: 3 }] }),
];

// Like the server under `stack_series`: the headline counts books, the page holds the slots.
const ebooksPreview = http.get("/api/ebooks", ({ request }) => {
  previews.push(new URL(request.url).searchParams);
  return HttpResponse.json(PREVIEW_PAGE, { headers: { "X-Total-Count": "3" } });
});

const countPosts = http.post("/api/account/stats-exclusions", () => {
  posts += 1;
  return new HttpResponse(null);
});

const withRule: Story["beforeEach"] = ({ msw }) => {
  previews.length = 0;
  posts = 0;
  server = aSettingsServer({ user: WITH_RULE });
  msw.use(
    ...settingsHandlers(server),
    ...filterSupport,
    ebooksPreview,
    countPosts,
  );
};

const row = (canvas: { getByTestId: (id: string) => HTMLElement }) =>
  canvas.getByTestId("user-setting-stats-exclusions");

export const ShowsLeaveOutNothingWhenRuleIsEmpty: Story = {
  beforeEach({ msw }) {
    previews.length = 0;
    msw.use(ebooksPreview);
  },
  play: async ({ canvas }) => {
    const stats = within(
      await canvas.findByTestId("user-setting-stats-exclusions"),
    );

    await expect(stats.getByText("Leave out of my stats")).toBeVisible();
    await expect(stats.getByText("Nothing left out.")).toBeVisible();
    await expect(
      stats.getByRole("button", { name: "Edit filters" }),
    ).toBeVisible();
    // An empty rule has nothing to count.
    await expect(previews).toEqual([]);
  },
};

export const OpensDialogFromEditFilters: Story = {
  parameters: { user: WITH_RULE },
  beforeEach: withRule,
  play: async ({ canvas, userEvent }) => {
    const stats = within(
      await canvas.findByTestId("user-setting-stats-exclusions"),
    );
    await expect(await stats.findByText("Tag: Sports")).toBeVisible();
    await expect(await stats.findByText("3 books")).toBeVisible();

    await userEvent.click(stats.getByRole("button", { name: "Edit filters" }));

    const dialog = within(
      canvas.getByRole("dialog", { name: "Leave out of my stats" }),
    );
    await expect(
      dialog.getByRole("group", { name: "Library filters" }),
    ).toBeVisible();
    await expect(await dialog.findByText("3 books left out")).toBeVisible();
    await expect(dialog.getByText("Aurora Station · 2")).toBeVisible();
    await expect(dialog.getByText("1 outside a series")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(previews.at(-1)?.get("stack_series")).toBe("true");
    await expect(previews.at(-1)?.get("filter")).toBe(JSON.stringify([SPORTS]));
  },
};

export const SavesChosenClausesOnSave: Story = {
  beforeEach({ msw }) {
    previews.length = 0;
    msw.use(...filterSupport, ebooksPreview);
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit filters" }),
    );
    const dialog = within(
      canvas.getByRole("dialog", { name: "Leave out of my stats" }),
    );

    await userEvent.click(dialog.getByRole("button", { name: /^Tag/ }));
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: "Sports" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Apply (1)" }));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: "Leave out of my stats" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("stats-exclusions-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(server.user.stats_exclusions).toEqual({ clauses: [SPORTS] });
  },
};

export const KeepsSettingWhenCancelled: Story = {
  parameters: { user: WITH_RULE },
  beforeEach: withRule,
  play: async ({ canvas, userEvent }) => {
    const stats = within(
      await canvas.findByTestId("user-setting-stats-exclusions"),
    );
    await userEvent.click(
      await stats.findByRole("button", { name: "Edit filters" }),
    );
    const dialog = within(
      canvas.getByRole("dialog", { name: "Leave out of my stats" }),
    );

    await userEvent.click(dialog.getByRole("button", { name: "Clear all" }));
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: "Leave out of my stats" }),
      ).toBeNull(),
    );
    await expect(stats.getByText("Tag: Sports")).toBeVisible();
    await expect(row(canvas)).not.toHaveTextContent("Nothing left out.");
    await expect(posts).toBe(0);
    await expect(server.user.stats_exclusions).toEqual({ clauses: [SPORTS] });
  },
};
