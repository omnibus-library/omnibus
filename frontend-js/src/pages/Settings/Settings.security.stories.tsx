import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { failing, hanging } from "../../testing/handlers";
import { SettingsRoutes } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";
import { aWireAuthSession } from "../../testing/wire";

let server: SettingsServer;

const HERE = aWireAuthSession({ id: 1, is_current: true });
const PHONE = aWireAuthSession({
  id: 2,
  client: "Omnibus on iPhone",
  kind: "bearer",
  created_at: 1_750_000_000,
  last_used_at: 1_750_100_000,
});

const meta = {
  title: "Pages/Settings/Security",
  component: SettingsRoutes,
  args: { path: "/settings?section=security" },
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    server = aSettingsServer();
    msw.use(...settingsHandlers(server));
  },
} satisfies Meta<typeof SettingsRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

// The always-mounted status gets its text a moment after the click.
const said = (
  canvas: { getByTestId: (id: string) => HTMLElement },
  testId: string,
  text: string,
) => waitFor(() => expect(canvas.getByTestId(testId)).toHaveTextContent(text));

export const ChangesThePassword: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Current password"),
      "old-password-123",
    );
    await userEvent.type(
      canvas.getByLabelText("New password"),
      "a brand new passphrase",
    );
    await userEvent.click(canvas.getByTestId("change-password-submit"));

    await said(canvas, "change-password-status", "Password changed.");
    await expect(canvas.getByLabelText("Current password")).toHaveValue("");
    await expect(canvas.getByLabelText("New password")).toHaveValue("");
    await expect(server.password).toBe("a brand new passphrase");
  },
};

export const RereadsSessionsAfterThePasswordChanges: Story = {
  beforeEach: () => {
    server.sessions = [HERE, PHONE];
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findAllByTestId("account-session-row"),
    ).toHaveLength(2);
    await userEvent.type(
      canvas.getByLabelText("Current password"),
      "old-password-123",
    );
    await userEvent.type(
      canvas.getByLabelText("New password"),
      "a brand new passphrase",
    );
    await userEvent.click(canvas.getByTestId("change-password-submit"));

    await waitFor(() =>
      expect(canvas.getAllByTestId("account-session-row")).toHaveLength(1),
    );
    await expect(canvas.queryByText("Omnibus on iPhone")).toBeNull();
  },
};

export const AsksForBothPasswords: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Current password"),
      "old-password-123",
    );
    await userEvent.click(canvas.getByTestId("change-password-submit"));

    await said(
      canvas,
      "change-password-status",
      "Enter your current and new password.",
    );
    await expect(server.password).toBe("old-password-123");
  },
};

export const RefusesAWrongCurrentPassword: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Current password"),
      "not my password",
    );
    await userEvent.type(
      canvas.getByLabelText("New password"),
      "a brand new passphrase",
    );
    await userEvent.click(canvas.getByTestId("change-password-submit"));

    await said(
      canvas,
      "change-password-status",
      "current password is incorrect",
    );
    await expect(canvas.getByTestId("change-password-status")).toHaveClass(
      "error",
    );
    await expect(canvas.getByLabelText("New password")).toHaveValue(
      "a brand new passphrase",
    );
  },
};

export const RefusesAWeakNewPassword: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Current password"),
      "old-password-123",
    );
    await userEvent.type(canvas.getByLabelText("New password"), "short");
    await userEvent.click(canvas.getByTestId("change-password-submit"));

    await said(
      canvas,
      "change-password-status",
      "password too short (min 10)",
    );
    await expect(canvas.getByLabelText("Current password")).toHaveValue(
      "old-password-123",
    );
  },
};

// ── Sessions ─────────────────────────────────────────────────────

const withSessions = () => {
  server.sessions = [HERE, PHONE];
};

export const FindsYourSessionsBeforeSayingThereAreNone: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/auth/sessions"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("account-sessions-loading"),
    ).toHaveTextContent("Finding your sessions");
    await expect(canvas.queryByTestId("account-sessions-empty")).toBeNull();
  },
};

export const SaysWhyTheSessionsDidNotLoad: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/auth/sessions", 500));
  },
  play: async ({ canvas }) => {
    await said(canvas, "account-sessions-status", "failed with 500");
    await expect(canvas.getByTestId("account-sessions-status")).toHaveClass(
      "error",
    );
    await expect(canvas.queryByTestId("account-sessions-empty")).toBeNull();
  },
};

export const SaysWhenThereAreNoSessions: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("account-sessions-empty"),
    ).toHaveTextContent("No sessions found.");
  },
};

export const ListsSessionsAndTagsTheCurrentOne: Story = {
  beforeEach: withSessions,
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("account-session-row");
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent("Firefox on Linux (this device)");
    await expect(rows[0]).toHaveTextContent("2025-10-09");
    await expect(rows[0]).toHaveTextContent("2025-10-10");
    await expect(
      canvas.queryByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    ).toBeNull();
    await expect(
      canvas.getByRole("button", {
        name: "Revoke the session on Omnibus on iPhone",
      }),
    ).toBeVisible();
  },
};

export const RevokesASessionOnceConfirmed: Story = {
  beforeEach: withSessions,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Revoke the session on Omnibus on iPhone",
      }),
    );
    await expect(
      await canvas.findByTestId("session-revoke-dialog"),
    ).toHaveTextContent("Sign out Omnibus on iPhone?");
    await userEvent.click(canvas.getByTestId("session-revoke-dialog-confirm"));

    await said(canvas, "account-sessions-status", "Session revoked.");
    await waitFor(() =>
      expect(canvas.getAllByTestId("account-session-row")).toHaveLength(1),
    );
    await expect(canvas.queryByText("Omnibus on iPhone")).toBeNull();
  },
};

export const ShowsWhyARevokeWasRefused: Story = {
  beforeEach({ msw }) {
    withSessions();
    msw.use(
      http.delete(
        "/api/auth/sessions/:id",
        () =>
          new HttpResponse("you have no live session with that id", {
            status: 404,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Revoke the session on Omnibus on iPhone",
      }),
    );
    await userEvent.click(
      await canvas.findByTestId("session-revoke-dialog-confirm"),
    );

    await said(
      canvas,
      "account-sessions-status",
      "you have no live session with that id",
    );
    await expect(canvas.getByTestId("account-sessions-status")).toHaveClass(
      "error",
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("session-revoke-dialog")).toBeNull(),
    );
  },
};
