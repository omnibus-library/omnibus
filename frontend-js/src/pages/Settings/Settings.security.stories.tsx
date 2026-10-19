import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { SettingsRoutes } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";

let server: SettingsServer;

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
      "password must be at least 10 characters",
    );
    await expect(canvas.getByLabelText("Current password")).toHaveValue(
      "old-password-123",
    );
  },
};
