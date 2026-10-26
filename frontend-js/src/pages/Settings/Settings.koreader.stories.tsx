import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { failing, hanging } from "../../testing/handlers";
import { SettingsRoutes, said } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  kosyncPassword,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";
import { aWireKoboDevice, WIRE_ADA } from "../../testing/wire";

let server: SettingsServer;

const meta = {
  title: "Pages/Settings/KOReader",
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

const PLUGIN = aWireKoboDevice({ id: 1, name: "Libra", kind: "koreader" });
const NO_PLUGIN = aWireKoboDevice({ id: 2, name: "Clara", kind: "kosync" });
const SAGE = aWireKoboDevice({ id: 3, name: "Sage", kind: "kosync" });

/** The KOReader card, so a Kobo card's own controls never answer a query. */
const card = (canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"]) =>
  within(canvas.getByTestId("koreader-devices-card"));

const withNoPlugin = (...devices: (typeof NO_PLUGIN)[]) => {
  server.kobo = devices;
  server.kosyncConfigured = true;
};

const addNamed = async (
  canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"],
  userEvent: Parameters<NonNullable<Story["play"]>>[0]["userEvent"],
  name: string,
  { noPlugin = false } = {},
) => {
  await userEvent.type(
    await canvas.findByTestId("koreader-device-name-input"),
    name,
  );
  if (noPlugin) await userEvent.click(canvas.getByTestId("koreader-no-plugin"));
  await userEvent.click(canvas.getByTestId("koreader-device-add"));
};

export const FindsYourKoreadersBeforeSayingNoneAreRegistered: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/account/kobo-devices"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("koreader-devices-loading"),
    ).toHaveTextContent("Finding your KOReaders");
    await expect(canvas.queryByTestId("koreader-devices-empty")).toBeNull();
  },
};

export const OpensTheSetupStepsForAReaderWithNoKoreader: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("koreader-devices-empty"),
    ).toHaveTextContent("No KOReader registered yet.");
    const setup = canvas.getByTestId("koreader-setup");
    await expect(setup).toHaveAttribute("open");
    await expect(setup).toHaveTextContent("How to connect a KOReader");
    for (const path of [
      ".adds/koreader/plugins",
      "applications/koreader/plugins",
    ]) {
      await expect(setup).toHaveTextContent(path);
    }
    await expect(setup).toHaveTextContent(
      "Tick Connect without the plugin before adding",
    );
    await expect(canvas.getByTestId("koreader-shelves-link")).toHaveAttribute(
      "href",
      "/shelves",
    );
  },
};

export const FoldsTheSetupStepsOnceAKoreaderOfEitherKindExists: Story = {
  beforeEach() {
    server.kobo = [NO_PLUGIN];
  },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("koreader-device-row");
    await expect(canvas.getByTestId("koreader-setup")).not.toHaveAttribute(
      "open",
    );
  },
};

export const SaysWhyTheKoreadersDidNotLoad: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/account/kobo-devices", 500));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("koreader-devices-status")).toHaveTextContent(
        "Couldn’t load your KOReaders: failed with 500",
      ),
    );
    await expect(canvas.queryByTestId("koreader-devices-empty")).toBeNull();
  },
};

export const AsksForANameBeforeAddingAKoreader: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("koreader-devices-empty");
    await userEvent.click(canvas.getByTestId("koreader-device-add"));

    await said(
      canvas,
      "koreader-devices-status",
      "Enter a name for your device.",
    );
    await expect(server.kobo).toEqual([]);
  },
};

export const AddsAPluginKoreaderThatOffersItsDownload: Story = {
  play: async ({ canvas, userEvent }) => {
    await addNamed(canvas, userEvent, "Libra");

    await said(
      canvas,
      "koreader-devices-status",
      "Added Libra. Download its plugin and put it on the device.",
    );
    const row = await canvas.findByTestId("koreader-device-row");
    await expect(row).toHaveTextContent("Not synced yet");
    await expect(row).toHaveTextContent("Added just now");
    const download = within(row).getByTestId("koreader-plugin-download");
    await expect(download).toHaveTextContent("Download plugin");
    await expect(download).toHaveClass("primary");
    await expect(download).toHaveAttribute(
      "href",
      "/api/account/kobo-devices/1/koreader-plugin",
    );
    await expect(within(row).queryByTestId("koreader-device-token")).toBeNull();
    await expect(server.kobo.map((d) => d.kind)).toEqual(["koreader"]);
    await expect(canvas.getByTestId("koreader-device-name-input")).toHaveValue(
      "",
    );
  },
};

export const OffersARedownloadOnceSyncedAndAskForOneAfterAFailure: Story = {
  beforeEach() {
    server.kobo = [
      { ...PLUGIN, last_sync_at: 1_704_067_200 },
      {
        ...aWireKoboDevice({ id: 4, name: "Aurora", kind: "koreader" }),
        last_sync_at: 1_704_067_200,
        last_sync_error: "Couldn’t download Alpha: 404",
      },
    ];
  },
  play: async ({ canvas }) => {
    const [synced, failed] = await canvas.findAllByTestId(
      "koreader-device-row",
    );
    await expect(synced).toHaveTextContent("Last sync Jan 1, 2024");
    await expect(synced).not.toHaveTextContent("Not synced yet");
    const download = within(synced as HTMLElement).getByTestId(
      "koreader-plugin-download",
    );
    await expect(download).toHaveAccessibleName("Redownload plugin for Libra");
    await expect(download).toHaveTextContent("Redownload plugin");
    await expect(download).not.toHaveClass("primary");
    await expect(failed).toHaveTextContent(
      "Last sync failed: Couldn’t download Alpha: 404",
    );
    await expect(failed).toHaveTextContent("Redownload the plugin");
  },
};

export const HidesTheDownloadFromAReaderWhoMayNotDownload: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false, can_download: false } },
  beforeEach() {
    server.kobo = [PLUGIN];
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("koreader-device-row"),
    ).toHaveTextContent("Libra");
    await expect(canvas.queryByTestId("koreader-plugin-download")).toBeNull();
  },
};

export const RemovesAPluginKoreaderWithoutTouchingTheLogin: Story = {
  beforeEach() {
    server.kobo = [PLUGIN];
    server.kosyncConfigured = true;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove Libra" }),
    );
    await expect(
      await canvas.findByTestId("koreader-remove-dialog"),
    ).toHaveTextContent("To sync it again, add it as a new device.");
    await userEvent.click(canvas.getByTestId("koreader-remove-dialog-confirm"));

    await said(canvas, "koreader-devices-status", "KOReader removed.");
    await expect(server.kobo).toEqual([]);
    await expect(server.kosyncConfigured).toBe(true);
  },
};

export const OffersTheNoPluginCheckboxUnticked: Story = {
  play: async ({ canvas }) => {
    const checkbox = await canvas.findByLabelText(
      "Connect without the plugin (Progress sync only)",
    );
    await expect(checkbox).not.toBeChecked();
    await expect(
      card(canvas).getByText(/built-in Progress sync/),
    ).toBeVisible();
  },
};

export const AddsANoPluginKoreaderAndShowsItsLoginOnce: Story = {
  play: async ({ canvas, userEvent }) => {
    await addNamed(canvas, userEvent, "Clara", { noPlugin: true });

    await said(
      canvas,
      "koreader-devices-status",
      "Added Clara. Copy its login now: the password is shown once.",
    );
    const row = await canvas.findByTestId("koreader-device-row");
    await expect(row).toHaveTextContent("No plugin");
    await expect(row).toHaveTextContent("Progress sync login (shown once)");
    await expect(
      within(row).queryByTestId("koreader-plugin-download"),
    ).toBeNull();
    await expect(within(row).getByTestId("kosync-url")).toHaveValue(
      `${window.location.origin}/kosync`,
    );
    await expect(within(row).getByTestId("kosync-username")).toHaveValue("ada");
    await expect(within(row).getByTestId("kosync-password")).toHaveValue(
      kosyncPassword(1),
    );
    await expect(within(row).getByTestId("kosync-password-copy")).toBeVisible();
    await expect(server.kobo.map((d) => d.kind)).toEqual(["kosync"]);
    await expect(canvas.getByTestId("koreader-no-plugin")).not.toBeChecked();
  },
};

export const ReusesTheLoginForASecondNoPluginKoreader: Story = {
  beforeEach() {
    withNoPlugin(NO_PLUGIN);
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findAllByTestId("koreader-device-row");
    await addNamed(canvas, userEvent, "Sage", { noPlugin: true });

    await said(canvas, "koreader-devices-status", "Added Sage.");
    const rows = await canvas.findAllByTestId("koreader-device-row");
    const sage = rows.find((row) => row.textContent?.includes("Sage"));
    await expect(sage).toHaveTextContent(
      "Uses your existing Progress sync login",
    );
    await expect(sage).toHaveTextContent(
      "same server URL, username and password as your other no-plugin KOReaders. The password was shown once, when it was generated.",
    );
    await expect(
      within(sage as HTMLElement).queryByTestId("kosync-password"),
    ).toBeNull();
    await expect(server.kosyncPasswords).toBe(0);
  },
};

export const UsesAStandaloneLoginForTheFirstNoPluginKoreader: Story = {
  beforeEach() {
    server.kosyncConfigured = true;
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("koreader-devices-empty");
    await addNamed(canvas, userEvent, "Clara", { noPlugin: true });

    await said(canvas, "koreader-devices-status", "Added Clara.");
    await expect(
      await canvas.findByTestId("koreader-login-panel"),
    ).toHaveTextContent(
      "same server URL, username and password as your other no-plugin KOReaders. The password was shown once, when it was generated.",
    );
  },
};

export const SteadyNoPluginKoreadersOfferANewPassword: Story = {
  beforeEach() {
    withNoPlugin(NO_PLUGIN);
  },
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("koreader-device-row");
    await expect(row).toHaveTextContent(
      "Syncs your place through KOReader’s Progress sync.",
    );
    await expect(within(row).getByTestId("kosync-generate")).toHaveTextContent(
      "Generate a new password",
    );
    await expect(within(row).queryByTestId("koreader-signed-out")).toBeNull();
  },
};

export const AsksBeforeGeneratingAndNamesEveryNoPluginKoreader: Story = {
  beforeEach() {
    withNoPlugin(NO_PLUGIN, SAGE);
  },
  play: async ({ canvas, userEvent }) => {
    const [first] = await canvas.findAllByTestId("kosync-generate");
    await userEvent.click(first as HTMLElement);
    const dialog = await canvas.findByTestId("kosync-replace-dialog");
    await expect(dialog).toHaveTextContent(
      "Generate a new Progress sync password?",
    );
    await expect(dialog).toHaveTextContent(
      "Clara and Sage stop syncing their place until you log in on them again with the new password.",
    );
    await expect(dialog).toHaveTextContent(
      "Plugin KOReaders and Kobos aren’t affected.",
    );
    await userEvent.click(canvas.getByTestId("kosync-replace-dialog-cancel"));

    await waitFor(() =>
      expect(canvas.queryByTestId("kosync-replace-dialog")).toBeNull(),
    );
    await expect(server.kosyncPasswords).toBe(0);
  },
};

export const GeneratesANewPasswordAndSignsEveryNoPluginKoreaderOut: Story = {
  beforeEach() {
    withNoPlugin(NO_PLUGIN, SAGE);
  },
  play: async ({ canvas, userEvent }) => {
    const [, second] = await canvas.findAllByTestId("kosync-generate");
    await userEvent.click(second as HTMLElement);
    await userEvent.click(
      await canvas.findByTestId("kosync-replace-dialog-confirm"),
    );

    await said(
      canvas,
      "koreader-devices-status",
      "New password generated. Copy it now: it is shown once.",
    );
    const sage = (await canvas.findAllByTestId("koreader-device-row"))[1];
    await expect(sage).toHaveTextContent(
      "New Progress sync login (shown once)",
    );
    await expect(sage).toHaveTextContent(
      "Log in again on every no-plugin KOReader (here, Clara and Sage): Progress sync › Custom sync server › Login.",
    );
    await expect(
      within(sage as HTMLElement).getByTestId("kosync-password"),
    ).toHaveValue(kosyncPassword(1));
    await expect(canvas.getAllByTestId("koreader-signed-out")).toHaveLength(2);
    await expect(
      canvas.getAllByTestId("koreader-device-row")[0],
    ).toHaveTextContent("Signed out · log in again");
  },
};

export const KeepsTheShownLoginWhenAGenerateIsRefused: Story = {
  beforeEach({ msw }) {
    withNoPlugin(NO_PLUGIN);
    msw.use(
      http.post(
        "/api/account/kosync",
        () => new HttpResponse("password store is down", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("kosync-generate"));
    await userEvent.click(
      await canvas.findByTestId("kosync-replace-dialog-confirm"),
    );

    await said(canvas, "koreader-devices-status", "password store is down");
    await expect(canvas.getByTestId("koreader-devices-status")).toHaveClass(
      "error",
    );
    await expect(canvas.queryByTestId("koreader-signed-out")).toBeNull();
    await waitFor(() =>
      expect(canvas.queryByTestId("kosync-replace-dialog")).toBeNull(),
    );
  },
};

export const RemovesOneOfSeveralNoPluginKoreadersAndSaysItKeepsSyncing: Story =
  {
    beforeEach() {
      withNoPlugin(NO_PLUGIN, SAGE);
    },
    play: async ({ canvas, userEvent }) => {
      await userEvent.click(
        await canvas.findByRole("button", { name: "Remove Clara" }),
      );
      const dialog = await canvas.findByTestId("koreader-remove-dialog");
      await expect(dialog).toHaveTextContent("Remove Clara?");
      await expect(dialog).toHaveTextContent(
        "Clara is removed from this list, but it can still sync its place until you generate a new password: every no-plugin KOReader shares one login.",
      );
      await expect(dialog).not.toHaveTextContent("last no-plugin KOReader");
      await userEvent.click(
        canvas.getByTestId("koreader-remove-dialog-confirm"),
      );

      await said(canvas, "koreader-devices-status", "KOReader removed.");
      await expect(server.kosyncConfigured).toBe(true);
    },
  };

export const SaysTheLoginGoesWithTheLastNoPluginKoreader: Story = {
  beforeEach() {
    withNoPlugin(NO_PLUGIN);
    server.kobo = [PLUGIN, NO_PLUGIN];
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove Clara" }),
    );
    await expect(
      await canvas.findByTestId("koreader-remove-dialog"),
    ).toHaveTextContent(
      "It’s your last no-plugin KOReader, so this also turns off Progress sync: its password stops working.",
    );
    await userEvent.click(canvas.getByTestId("koreader-remove-dialog-confirm"));

    await said(canvas, "koreader-devices-status", "KOReader removed.");
    await expect(server.kosyncConfigured).toBe(false);
    await expect(server.kobo.map((d) => d.name)).toEqual(["Libra"]);
  },
};

export const SitsTheNameFieldAndAddButtonOnOneRow: Story = {
  play: async ({ canvas }) => {
    const row = (
      await canvas.findByTestId("koreader-device-name-input")
    ).closest(".device-add-row");
    await expect(row).not.toBeNull();
    await expect(
      within(row as HTMLElement).getByTestId("koreader-device-add"),
    ).toBeVisible();
  },
};

export const NamesEachCardsDeviceNameFieldAfterItsCard: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("koreader-device-name-input"),
    ).toHaveAccessibleName("KOReader Device name");
    await expect(
      canvas.getByTestId("kobo-device-name-input"),
    ).toHaveAccessibleName("Kobo Device name");
  },
};

export const WaitsForTheKoreadersBeforeAddingOne: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/account/kobo-devices"));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("koreader-devices-loading");
    await expect(canvas.getByTestId("koreader-device-add")).toBeDisabled();
  },
};
