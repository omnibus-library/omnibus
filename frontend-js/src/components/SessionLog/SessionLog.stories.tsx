import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { parseBookUuid } from "../../api";
import { failing, hanging, sessionLogHandler } from "../../testing/handlers";
import { aWireSession } from "../../testing/wire";
import { SessionLog } from "./SessionLog";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");

if (!UUID) throw new Error("fixture uuid");

const meta = {
  title: "Components/SessionLog",
  component: SessionLog,
  args: { uuid: UUID },
} satisfies Meta<typeof SessionLog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/stats/sessions"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("session-log-loading")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(sessionLogHandler([]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No sittings recorded yet."),
    ).toBeInTheDocument();
  },
};

export const PagesNewestFirst: Story = {
  beforeEach({ msw }) {
    msw.use(
      sessionLogHandler([
        aWireSession({
          started_at: 1_700_000_000,
          seconds: 2700,
          format: "reading",
        }),
        aWireSession({
          started_at: 1_699_900_000,
          seconds: 7500,
          format: "listening",
        }),
        aWireSession({
          started_at: 1_699_800_000,
          seconds: 3600,
          format: "mixed",
        }),
      ]),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const rows = await canvas.findAllByTestId("session-log-row");
    await expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Read45m$/),
      expect.stringMatching(/Listened2h 5m$/),
    ]);

    await userEvent.click(canvas.getByRole("button", { name: "Show more" }));

    await waitFor(() =>
      expect(canvas.getAllByTestId("session-log-row")).toHaveLength(3),
    );
    await expect(
      within(
        canvas.getAllByTestId("session-log-row")[2] as HTMLElement,
      ).getByText("Read & listened"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/stats/sessions", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load your session log: failed with 500",
    );
    await expect(
      canvas.queryByTestId("session-log-empty"),
    ).not.toBeInTheDocument();
  },
};
