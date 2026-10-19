import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { failing, hanging } from "../../testing/handlers";
import { SettingsRoutes } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";

let server: SettingsServer;

const TARGETS: SettingsServer["goals"] = [24, 30, 45];

const meta = {
  title: "Pages/Settings/Goals",
  component: SettingsRoutes,
  args: { path: "/settings?section=goals" },
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    server = aSettingsServer();
    msw.use(...settingsHandlers(server));
  },
} satisfies Meta<typeof SettingsRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

// The always-mounted status gets its text a moment after the click.
const status = (canvas: { getByTestId: (id: string) => HTMLElement }) =>
  canvas.getByTestId("goals-status");

// Runs after the meta's, so it edits the server the handlers already read.
const savedTargets = () => {
  server.goals = TARGETS;
};

export const WaitsForTheRead: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/stats"));
  },
  play: async ({ canvas }) => {
    const books = await canvas.findByLabelText("Books this year");
    await expect(books).toBeDisabled();
    await expect(books).toHaveClass("ld-unknown");
    await expect(books).not.toHaveAttribute("placeholder");
    await expect(status(canvas)).toHaveTextContent("Reading your goals");
    await expect(canvas.getByTestId("goals-save")).toBeDisabled();
  },
};

export const FailsToRead: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/stats", 500));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(status(canvas)).toHaveTextContent(
        "Couldn’t load your goals. Reload to try again.",
      ),
    );
    await expect(canvas.getByLabelText("Pages a day")).toBeDisabled();
    await expect(canvas.getByTestId("goals-save")).toBeDisabled();
  },
};

export const ShowsNoTargets: Story = {
  play: async ({ canvas }) => {
    const books = await canvas.findByLabelText("Books this year");
    await waitFor(() => expect(books).toBeEnabled());
    await expect(books).toHaveValue(null);
    await expect(books).toHaveAttribute("placeholder", "No target");
    await expect(books).toHaveAttribute("min", "1");
    await expect(books).toHaveAttribute("max", "10000");
    await expect(canvas.getByLabelText("Pages a day")).toHaveAttribute(
      "max",
      "2000",
    );
    await expect(canvas.getByLabelText("Minutes a day")).toHaveAttribute(
      "max",
      "1440",
    );
    await expect(canvas.getByTestId("goals-save")).toBeDisabled();
  },
};

export const ShowsTheSavedTargets: Story = {
  beforeEach: savedTargets,
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("Books this year")).toHaveValue(24),
    );
    await expect(canvas.getByLabelText("Pages a day")).toHaveValue(30);
    await expect(canvas.getByLabelText("Minutes a day")).toHaveValue(45);
    await expect(canvas.getByTestId("goals-save")).toBeDisabled();
  },
};

export const SavesOnlyTheChangedTargets: Story = {
  beforeEach: savedTargets,
  play: async ({ canvas, userEvent }) => {
    const pages = await canvas.findByLabelText("Pages a day");
    await waitFor(() => expect(pages).toHaveValue(30));
    await userEvent.clear(pages);
    await userEvent.type(pages, "40");
    await userEvent.click(canvas.getByTestId("goals-save"));

    await waitFor(() =>
      expect(status(canvas)).toHaveTextContent("Goals saved."),
    );
    await expect(server.goalWrites).toEqual(["pages=40"]);
    await expect(canvas.getByTestId("goals-save")).toBeDisabled();
  },
};

export const ClearsATargetWhenEmptied: Story = {
  beforeEach: savedTargets,
  play: async ({ canvas, userEvent }) => {
    const minutes = await canvas.findByLabelText("Minutes a day");
    await waitFor(() => expect(minutes).toHaveValue(45));
    await userEvent.clear(minutes);
    await userEvent.click(canvas.getByTestId("goals-save"));

    await waitFor(() =>
      expect(status(canvas)).toHaveTextContent("Goals saved."),
    );
    await expect(server.goalWrites).toEqual(["minutes=null"]);
    await expect(minutes).toHaveAttribute("placeholder", "No target");
  },
};

export const MarksAnInvalidDraft: Story = {
  beforeEach: savedTargets,
  play: async ({ canvas, userEvent }) => {
    const pages = await canvas.findByLabelText("Pages a day");
    await waitFor(() => expect(pages).toHaveValue(30));
    await userEvent.clear(pages);
    await userEvent.type(pages, "0");
    await userEvent.click(canvas.getByTestId("goals-save"));

    await expect(
      await canvas.findByTestId("goal-pages-error"),
    ).toHaveTextContent("Pick a target between 1 and 2000.");
    await expect(pages).toBeInvalid();
    await waitFor(() =>
      expect(status(canvas)).toHaveTextContent(
        "Nothing saved yet. Check the targets marked above.",
      ),
    );
    await expect(server.goalWrites).toEqual([]);
  },
};

export const MarksAFractionalDraft: Story = {
  play: async ({ canvas, userEvent }) => {
    const books = await canvas.findByLabelText("Books this year");
    await waitFor(() => expect(books).toBeEnabled());
    await userEvent.type(books, "1.5");
    await userEvent.click(canvas.getByTestId("goals-save"));

    await expect(
      await canvas.findByTestId("goal-books-error"),
    ).toHaveTextContent("Enter a whole number of books.");
  },
};

export const ReportsWhichGoalDidNotSave: Story = {
  beforeEach() {
    savedTargets();
    server.refuseGoals = ["pages"];
  },
  play: async ({ canvas, userEvent }) => {
    const [books, pages, minutes] = [
      await canvas.findByLabelText("Books this year"),
      canvas.getByLabelText("Pages a day"),
      canvas.getByLabelText("Minutes a day"),
    ];
    await waitFor(() => expect(pages).toHaveValue(30));
    for (const [input, value] of [
      [books, "30"],
      [pages, "40"],
      [minutes, "50"],
    ] as const) {
      await userEvent.clear(input);
      await userEvent.type(input, value);
    }
    await userEvent.click(canvas.getByTestId("goals-save"));

    await waitFor(() =>
      expect(status(canvas)).toHaveTextContent(
        "Saved, except Pages a day — try that one again.",
      ),
    );
    await expect(canvas.getByTestId("goal-pages-error")).toHaveTextContent(
      "This one didn’t save. Try again.",
    );
    await expect(pages).toHaveValue(40);
    await expect(server.goalWrites).toEqual(["books=30", "minutes=50"]);
    await expect(canvas.getByTestId("goals-save")).toBeEnabled();
  },
};

export const AsksBeforeLeavingEditedGoals: Story = {
  play: async ({ canvas, userEvent }) => {
    const books = await canvas.findByLabelText("Books this year");
    await waitFor(() => expect(books).toBeEnabled());
    await userEvent.type(books, "12");
    await userEvent.click(canvas.getByTestId("settings-nav-profile"));

    await expect(await canvas.findByTestId("unsaved-confirm")).toBeVisible();
  },
};
