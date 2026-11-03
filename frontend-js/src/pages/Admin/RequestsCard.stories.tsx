import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import {
  aWireRequestsSettings,
  type RequestsWrites,
  requestsHandlers,
} from "../../testing/adminHandlers";
import { failing, hanging } from "../../testing/handlers";
import { RequestsCard } from "./RequestsCard";

const SETTINGS = "/api/admin/requests/settings";
const TEST_INDEXER = `${SETTINGS}/test-indexer`;
const TEST_CLIENT = `${SETTINGS}/test-client`;

const writes: RequestsWrites = { saved: [], tests: [] };

const meta = {
  title: "Pages/Admin/RequestsCard",
  component: RequestsCard,
  beforeEach({ msw }) {
    writes.saved.length = 0;
    writes.tests.length = 0;
    msw.use(...requestsHandlers(aWireRequestsSettings(), writes));
  },
} satisfies Meta<typeof RequestsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAVE = "Save request settings";

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(SETTINGS));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Book requests" }),
    ).toBeInTheDocument();
    const status = canvas.getByTestId("requests-status");
    await expect(status).toHaveTextContent("Checking…");
    await expect(canvas.getByText("Checking…")).toHaveClass("ld-sheen");
    await expect(canvas.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Test Prowlarr" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Test qBittorrent" }),
    ).toBeDisabled();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", SETTINGS, 500));
  },
  play: async ({ canvas }) => {
    const message = await canvas.findByText(
      "Couldn’t read the current settings: failed with 500",
    );
    await expect(message).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("requests-status")).toHaveTextContent(
      "Status unavailable",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: SAVE })).toBeDisabled();
  },
};

export const ShowsSavedConnections: Story = {
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("Prowlarr address")).toHaveValue(
        "http://prowlarr:9696",
      ),
    );
    await expect(canvas.getByLabelText("Prowlarr API key")).toHaveValue("");
    await expect(canvas.getByLabelText("Prowlarr API key")).toHaveAttribute(
      "placeholder",
      "abcd…wxyz (unchanged)",
    );
    await expect(canvas.getByLabelText("qBittorrent address")).toHaveValue(
      "http://qbittorrent:8080",
    );
    await expect(canvas.getByLabelText("qBittorrent username")).toHaveValue(
      "admin",
    );
    await expect(canvas.getByLabelText("qBittorrent password")).toHaveValue("");
    await expect(canvas.getByLabelText("qBittorrent password")).toHaveAttribute(
      "placeholder",
      "•••• (unchanged)",
    );
    await expect(canvas.getByLabelText("Download category")).toHaveValue(
      "omnibus",
    );
    await expect(
      canvas.getByLabelText("Completed folder, as qBittorrent sees it"),
    ).toHaveValue("/downloads");
    await expect(
      canvas.getByLabelText("The same folder, as Omnibus sees it"),
    ).toHaveValue("/mnt/downloads");
    const status = canvas.getByTestId("requests-status");
    await expect(status).toHaveTextContent(
      "Prowlarr and qBittorrent addresses set",
    );
    await expect(status.querySelector(".api-key-dot")).toHaveClass("connected");
  },
};

export const ShowsUnsetConnections: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...requestsHandlers(
        aWireRequestsSettings({
          prowlarr_url: null,
          prowlarr_api_key_masked: null,
          prowlarr_api_key_source: "none",
          download_client_url: null,
          download_client_username: null,
          download_client_password_masked: null,
          download_client_path_prefix: null,
          download_path_prefix: null,
        }),
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("requests-status")).toHaveTextContent(
        "Not set up",
      ),
    );
    await expect(canvas.getByLabelText("Prowlarr address")).toHaveValue("");
    await expect(canvas.getByLabelText("Prowlarr API key")).toHaveAttribute(
      "placeholder",
      "",
    );
    await expect(canvas.getByRole("button", { name: SAVE })).toBeEnabled();
  },
};

export const SavesWithoutSecretsWhenTheyAreBlank: Story = {
  play: async ({ canvas, userEvent }) => {
    const address = canvas.getByLabelText("Prowlarr address");
    await waitFor(() => expect(address).toHaveValue("http://prowlarr:9696"));
    await userEvent.clear(address);
    await userEvent.type(address, " http://prowlarr.lan:9696 ");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    const message = await canvas.findByText("Request settings saved.");
    await expect(message).toHaveClass("settings-status", "success");
    await expect(writes.saved).toEqual([
      {
        prowlarr_url: "http://prowlarr.lan:9696",
        download_client_kind: "qbittorrent",
        download_client_url: "http://qbittorrent:8080",
        download_client_username: "admin",
        download_client_category: "omnibus",
        download_client_path_prefix: "/downloads",
        download_path_prefix: "/mnt/downloads",
      },
    ]);
  },
};

export const SavesATypedKeyAndClearsTheField: Story = {
  play: async ({ canvas, userEvent }) => {
    const key = canvas.getByLabelText("Prowlarr API key");
    await waitFor(() =>
      expect(canvas.getByLabelText("Prowlarr address")).toHaveValue(
        "http://prowlarr:9696",
      ),
    );
    await userEvent.type(key, "new key");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    await canvas.findByText("Request settings saved.");
    await expect(writes.saved[0]).toMatchObject({
      prowlarr_api_key: "new key",
    });
    await expect(writes.saved[0]).not.toHaveProperty(
      "download_client_password",
    );
    await waitFor(() => expect(key).toHaveValue(""));
  },
};

export const RefusesAnAddressThatIsNotHttp: Story = {
  play: async ({ canvas, userEvent }) => {
    const address = canvas.getByLabelText("qBittorrent address");
    await waitFor(() => expect(address).toHaveValue("http://qbittorrent:8080"));
    await userEvent.clear(address);
    await userEvent.type(address, "ftp://qbittorrent");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    const message = await canvas.findByText(
      "Enter an http:// or https:// address.",
    );
    await expect(message).toHaveClass("settings-status", "error");
    await expect(writes.saved).toEqual([]);
  },
};

export const ShowsWhySavingFailed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.put(
        SETTINGS,
        () =>
          new HttpResponse("download client username exceeds 255 bytes", {
            status: 422,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("Prowlarr address")).toHaveValue(
        "http://prowlarr:9696",
      ),
    );
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    const message = await canvas.findByText(
      "Couldn’t save the request settings: download client username exceeds 255 bytes",
    );
    await expect(message).toHaveClass("settings-status", "error");
  },
};

export const TestsEachConnection: Story = {
  play: async ({ canvas, userEvent }) => {
    const prowlarr = canvas.getByRole("button", { name: "Test Prowlarr" });
    await waitFor(() => expect(prowlarr).toBeEnabled());
    await userEvent.click(prowlarr);

    const first = await canvas.findByText(
      "Prowlarr answered and accepted the saved settings.",
    );
    await expect(first).toHaveClass("settings-status", "success");
    await userEvent.click(
      canvas.getByRole("button", { name: "Test qBittorrent" }),
    );
    await canvas.findByText(
      "The download client answered and accepted the saved settings.",
    );
    await expect(writes.tests).toEqual(["prowlarr", "client"]);
  },
};

export const ShowsWhyATestFailed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        TEST_INDEXER,
        () => new HttpResponse("the API key was rejected", { status: 502 }),
      ),
      http.post(
        TEST_CLIENT,
        () => new HttpResponse("not set up yet", { status: 409 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const prowlarr = canvas.getByRole("button", { name: "Test Prowlarr" });
    await waitFor(() => expect(prowlarr).toBeEnabled());
    await userEvent.click(prowlarr);

    const first = await canvas.findByText(
      "Prowlarr test failed: the API key was rejected",
    );
    await expect(first).toHaveClass("settings-status", "error");
    await userEvent.click(
      canvas.getByRole("button", { name: "Test qBittorrent" }),
    );
    await canvas.findByText("The download client test failed: not set up yet");
  },
};
