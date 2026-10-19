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
import { WIRE_ADA } from "../../testing/wire";

let server: SettingsServer;

const WITH_KINDLE = { ...WIRE_ADA, kindle_email: "ada@kindle.com" };

const meta = {
  title: "Pages/Settings/Devices",
  component: SettingsRoutes,
  args: { path: "/settings?section=devices" },
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

export const ChecksDeliveryBeforeSayingAnything: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/kindle/delivery"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("kindle-delivery-loading"),
    ).toHaveTextContent("Checking email delivery…");
    await expect(canvas.queryByTestId("kindle-delivery")).toBeNull();
  },
};

export const ShowsTheSenderToApprove: Story = {
  play: async ({ canvas }) => {
    const delivery = await canvas.findByTestId("kindle-delivery");
    await expect(delivery).toHaveTextContent("library@example.com");
    await expect(
      canvas.getByRole("button", { name: "Copy sender address" }),
    ).toBeVisible();
  },
};

export const SendsAnAdminToSetUpEmailDelivery: Story = {
  beforeEach() {
    server.sender = null;
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Set up email delivery" }),
    ).toHaveAttribute("href", "/admin?section=integrations");
  },
};

export const SendsAMemberToTheAdministrator: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  beforeEach() {
    server.sender = null;
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("kindle-delivery"),
    ).toHaveTextContent("Ask your administrator.");
    await expect(
      canvas.queryByRole("link", { name: "Set up email delivery" }),
    ).toBeNull();
  },
};

export const DoesNotClaimDeliveryIsOffWhenTheReadFails: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/kindle/delivery", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("kindle-delivery"),
    ).toHaveTextContent("Couldn’t check whether email delivery is set up");
    await expect(canvas.getByTestId("kindle-delivery")).not.toHaveTextContent(
      "isn’t set up on this server yet",
    );
  },
};

export const ShowsNoAddressYet: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("kindle-email-connected"),
    ).toHaveTextContent("No Kindle email configured yet.");
    await expect(canvas.queryByTestId("kindle-email-clear")).toBeNull();
  },
};

export const SavesAnAddress: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Kindle email"),
      "ada@kindle.com",
    );
    await userEvent.click(canvas.getByTestId("kindle-email-save"));

    await said(canvas, "kindle-email-status", "Kindle email saved.");
    await expect(
      canvas.getByTestId("kindle-email-connected"),
    ).toHaveTextContent("A Kindle email is configured.");
    await expect(canvas.getByTestId("kindle-email-clear")).toBeVisible();
  },
};

export const RefusesAnAddress: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/account/kindle-email",
        () =>
          new HttpResponse("that doesn’t look like an email address", {
            status: 422,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Kindle email"),
      "ada@kindle.com",
    );
    await userEvent.click(canvas.getByTestId("kindle-email-save"));

    await said(
      canvas,
      "kindle-email-status",
      "that doesn’t look like an email address",
    );
    await expect(canvas.getByTestId("kindle-email-status")).toHaveClass(
      "error",
    );
    await expect(canvas.getByLabelText("Kindle email")).toHaveValue(
      "ada@kindle.com",
    );
  },
};

export const RefusesToSaveNothing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("kindle-email-save"));

    await said(canvas, "kindle-email-status", "Enter a Kindle email to save.");
    await expect(server.user.kindle_email).toBeNull();
  },
};

export const ClearsTheAddressOnceConfirmed: Story = {
  parameters: { user: WITH_KINDLE },
  beforeEach() {
    server.user = WITH_KINDLE;
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByLabelText("Kindle email")).toHaveValue(
      "ada@kindle.com",
    );
    await userEvent.click(canvas.getByTestId("kindle-email-clear"));
    await expect(
      await canvas.findByTestId("kindle-email-clear-dialog"),
    ).toHaveTextContent("ada@kindle.com");
    await userEvent.click(
      canvas.getByTestId("kindle-email-clear-dialog-confirm"),
    );

    await said(canvas, "kindle-email-status", "Kindle email cleared.");
    await expect(canvas.getByLabelText("Kindle email")).toHaveValue("");
    await waitFor(() =>
      expect(canvas.queryByTestId("kindle-email-clear")).toBeNull(),
    );
  },
};

export const AsksBeforeLeavingAnEditedAddress: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Kindle email"),
      "a@b.co",
    );
    await userEvent.click(canvas.getByTestId("settings-nav-profile"));

    await expect(await canvas.findByTestId("unsaved-confirm")).toBeVisible();
  },
};
