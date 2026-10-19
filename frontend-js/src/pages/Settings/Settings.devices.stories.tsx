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
import { aWireKoboDevice, WIRE_ADA } from "../../testing/wire";

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

// ── Kobo devices ─────────────────────────────────────────────────

const CLARA = aWireKoboDevice();
const LIBRA = aWireKoboDevice({ id: 2, name: "Libra", token: "tok-libra" });

const withKobos = () => {
  server.kobo = [CLARA, LIBRA];
};

export const FindsYourKobosBeforeSayingNoneAreRegistered: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/account/kobo-devices"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("kobo-devices-loading"),
    ).toHaveTextContent("Finding your Kobos");
    await expect(canvas.queryByTestId("kobo-devices-empty")).toBeNull();
  },
};

export const OpensTheSetupStepsForAReaderWithNoKobo: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("kobo-devices-empty"),
    ).toHaveTextContent("No Kobo registered yet.");
    await expect(canvas.getByTestId("kobo-setup")).toHaveAttribute("open");
    await expect(canvas.getByTestId("kobo-shelves-link")).toHaveAttribute(
      "href",
      "/shelves",
    );
    await expect(canvas.getByTestId("kobo-data-loss-warning")).toBeVisible();
    await expect(
      canvas.getAllByRole("link", { name: "omnibus-library/kobo-backup" })[0],
    ).toBeVisible();
  },
};

export const FoldsTheSetupStepsOnceAKoboExists: Story = {
  beforeEach: withKobos,
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("kobo-device-row");
    await expect(canvas.getByTestId("kobo-setup")).not.toHaveAttribute("open");
  },
};

export const SaysWhyTheKobosDidNotLoad: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/account/kobo-devices", 500));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("kobo-devices-status")).toHaveTextContent(
        "Couldn’t load your Kobos: failed with 500",
      ),
    );
    await expect(canvas.queryByTestId("kobo-devices-empty")).toBeNull();
  },
};

export const ListsEachKoboWithItsEndpoint: Story = {
  beforeEach: withKobos,
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByTestId("kobo-device-row")).toHaveLength(
      2,
    );
    await expect(canvas.getAllByTestId("kobo-endpoint-url")[0]).toHaveValue(
      `${window.location.origin}/kobo/tok-clara`,
    );
    await expect(
      canvas.getByRole("button", { name: "Copy the endpoint URL for Libra" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Regenerate token for Clara" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Remove Clara" }),
    ).toBeVisible();
  },
};

export const AddsAKobo: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Device name"),
      "  Clara  ",
    );
    await userEvent.click(canvas.getByTestId("kobo-device-add"));

    await said(
      canvas,
      "kobo-devices-status",
      "Kobo added. Copy its endpoint URL below.",
    );
    await expect(
      await canvas.findByTestId("kobo-device-row"),
    ).toHaveTextContent("Clara");
    await expect(canvas.getByLabelText("Device name")).toHaveValue("");
    await expect(canvas.queryByTestId("kobo-devices-empty")).toBeNull();
  },
};

export const AsksForANameBeforeAdding: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("kobo-device-add"));

    await said(canvas, "kobo-devices-status", "Enter a name for your Kobo.");
    await expect(server.kobo).toEqual([]);
  },
};

export const RefusesAKoboName: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/account/kobo-devices",
        () =>
          new HttpResponse("enter a device name (1–100 characters)", {
            status: 422,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Device name"), "Clara");
    await userEvent.click(canvas.getByTestId("kobo-device-add"));

    await said(
      canvas,
      "kobo-devices-status",
      "enter a device name (1–100 characters)",
    );
    await expect(canvas.queryByTestId("kobo-device-row")).toBeNull();
  },
};

export const RegeneratesATokenOnceConfirmed: Story = {
  beforeEach: withKobos,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Regenerate token for Clara" }),
    );
    await expect(
      await canvas.findByTestId("kobo-regenerate-dialog"),
    ).toHaveTextContent("Regenerate the token for Clara?");
    await userEvent.click(canvas.getByTestId("kobo-regenerate-dialog-confirm"));

    await said(
      canvas,
      "kobo-devices-status",
      "Token regenerated. Update the URL on your Kobo.",
    );
    await waitFor(() =>
      expect(canvas.getAllByTestId("kobo-endpoint-url")[0]).toHaveValue(
        `${window.location.origin}/kobo/tok-clara-new`,
      ),
    );
    await expect(canvas.queryByTestId("kobo-regenerate-dialog")).toBeNull();
  },
};

export const KeepsTheTokenWhenRegenerateIsCancelled: Story = {
  beforeEach: withKobos,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Regenerate token for Clara" }),
    );
    await userEvent.click(
      await canvas.findByTestId("kobo-regenerate-dialog-cancel"),
    );

    await waitFor(() =>
      expect(canvas.queryByTestId("kobo-regenerate-dialog")).toBeNull(),
    );
    await expect(canvas.getAllByTestId("kobo-endpoint-url")[0]).toHaveValue(
      `${window.location.origin}/kobo/tok-clara`,
    );
  },
};

export const RemovesAKoboOnceConfirmed: Story = {
  beforeEach: withKobos,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove Clara" }),
    );
    await expect(
      await canvas.findByTestId("kobo-remove-dialog"),
    ).toHaveTextContent("Remove Clara?");
    await userEvent.click(canvas.getByTestId("kobo-remove-dialog-confirm"));

    await said(canvas, "kobo-devices-status", "Kobo removed.");
    await expect(await canvas.findAllByTestId("kobo-device-row")).toHaveLength(
      1,
    );
    await expect(canvas.queryByText("Clara")).toBeNull();
    await expect(server.kobo.map((d) => d.name)).toEqual(["Libra"]);
  },
};

export const ShowsWhatServerHoldsWhenARemoveFindsNothing: Story = {
  beforeEach: withKobos,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove Clara" }),
    );
    // Another tab removed it first.
    server.kobo = [LIBRA];
    await userEvent.click(
      await canvas.findByTestId("kobo-remove-dialog-confirm"),
    );

    await said(canvas, "kobo-devices-status", "kobo device not found");
    await expect(canvas.getByTestId("kobo-devices-status")).toHaveClass(
      "error",
    );
    await waitFor(() =>
      expect(canvas.getAllByTestId("kobo-device-row")).toHaveLength(1),
    );
  },
};

export const KeepsEarlierKobosWhenTheListFailedBeforeAnAdd: Story = {
  beforeEach({ msw }) {
    withKobos();
    let reads = 0;
    msw.use(
      http.get("/api/account/kobo-devices", () => {
        reads += 1;
        return reads === 1
          ? new HttpResponse("list is down", { status: 500 })
          : HttpResponse.json(server.kobo);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await said(canvas, "kobo-devices-status", "list is down");
    await userEvent.type(await canvas.findByLabelText("Device name"), "Aurora");
    await userEvent.click(canvas.getByTestId("kobo-device-add"));

    // The two it already had come back with the new one: the list was read again.
    await waitFor(() =>
      expect(canvas.getAllByTestId("kobo-device-row")).toHaveLength(3),
    );
  },
};
