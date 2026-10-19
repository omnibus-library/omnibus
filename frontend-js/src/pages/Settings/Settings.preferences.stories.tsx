import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { SetHiddenFormats } from "../../api/generated/schemas";
import { deferred } from "../../testing/handlers";
import { SettingsRoutes } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";
import { WIRE_ADA } from "../../testing/wire";

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

export const ShowsTheFourGroups: Story = {
  play: async ({ canvas }) => {
    for (const id of [
      "preferences-appearance",
      "preferences-library",
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

export const KeepsQueuedFormatsWhileAnotherPreferenceSaves: Story = {
  beforeEach({ msw }) {
    const gate = deferred();
    release = gate.release;
    msw.use(
      http.post("/api/account/hidden-formats", async ({ request }) => {
        await gate.promise;
        const { formats } = SetHiddenFormats.parse(await request.json());
        server.user = { ...server.user, hidden_formats: formats ?? [] };
        return new HttpResponse(null);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const epub = await canvas.findByRole("checkbox", { name: "EPUB" });
    const pdf = canvas.getByRole("checkbox", { name: "PDF" });
    await userEvent.click(epub);
    await userEvent.click(pdf);
    await userEvent.click(
      canvas.getByRole("switch", { name: "Share stats with household" }),
    );

    // The switch's save lands while both format saves are still held.
    await waitFor(() =>
      expect(canvas.getByTestId("share-stats-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(epub).toBeChecked();
    await expect(pdf).toBeChecked();

    release();
    await waitFor(() =>
      expect(canvas.getByTestId("hidden-formats-status")).toHaveTextContent(
        "Saved",
      ),
    );
    await expect(epub).toBeChecked();
    await expect(pdf).toBeChecked();
    await expect(server.user.hidden_formats).toEqual(["epub", "pdf"]);
  },
};
