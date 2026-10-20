import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  expectInvalidated,
  seedQueries,
  storyClient,
} from "../../testing/AppHarness";
import {
  aWireEbookConvert,
  aWireKeyStatus,
  ebookConvertHandlers,
  mcpHandlers,
  NO_KEY,
  secretKeyHandlers,
} from "../../testing/adminHandlers";
import { fakeClipboard } from "../../testing/clipboard";
import { deferred, failing, hanging } from "../../testing/handlers";
import { EbookConvertCard } from "./EbookConvertCard";
import { McpCard } from "./McpCard";
import { SecretKeyCard } from "./SecretKeyCard";

const HARDCOVER = "/api/hardcover-key";
const GOOGLE_BOOKS = "/api/google-books-key";
const EBOOK_CONVERT = "/api/settings/ebook-convert";
const MCP = "/api/settings/mcp";

const keys: (string | null)[] = [];
const paths: (string | null)[] = [];
const toggles: boolean[] = [];
const copied: string[] = [];

const meta = {
  title: "Pages/Admin/Integrations",
  component: SecretKeyCard,
  args: { kind: "hardcover" },
  beforeEach({ msw }) {
    for (const list of [keys, paths, toggles, copied]) list.length = 0;
    msw.use(
      ...secretKeyHandlers(HARDCOVER, aWireKeyStatus(), { saved: keys }),
      ...secretKeyHandlers(GOOGLE_BOOKS, NO_KEY, { saved: keys }),
      ...ebookConvertHandlers(aWireEbookConvert(), { saved: paths }),
      ...mcpHandlers(false, { saved: toggles }),
    );
  },
} satisfies Meta<typeof SecretKeyCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const GOOGLE_BOOKS_ARGS = { kind: "google-books" } as const;
const STATUS_READ_FAILED = "Couldn’t read the current status: failed with 500";

export const HardcoverLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(HARDCOVER));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Hardcover suggestions",
      }),
    ).toBeInTheDocument();
    const status = canvas.getByTestId("hardcover-status");
    await expect(status).toHaveTextContent("Checking…");
    await expect(status.querySelector(".api-key-dot")).toHaveClass("pending");
    await expect(canvas.getByLabelText("Hardcover API key")).toHaveAttribute(
      "placeholder",
      "hc_live_…",
    );
    await expect(
      canvas.getByRole("button", { name: "Save Hardcover key" }),
    ).toBeDisabled();
    await expect(
      canvas.queryByTestId("hardcover-clear"),
    ).not.toBeInTheDocument();
  },
};

export const HardcoverLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", HARDCOVER, 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(STATUS_READ_FAILED)).toHaveClass(
      "settings-status",
      "error",
    );
    await expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
      "Status unavailable",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Save Hardcover key" }),
    ).toBeDisabled();
  },
};

export const HardcoverTryAgainReadsTheStatusAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(HARDCOVER, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireKeyStatus()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
        "Connected · settings · hc_l…3f9a",
      ),
    );
    await expect(
      canvas.queryByText(STATUS_READ_FAILED),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  },
};

export const HardcoverShowsAConnectedKey: Story = {
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
        "Connected · settings · hc_l…3f9a",
      ),
    );
    await expect(
      canvas.getByTestId("hardcover-status").querySelector(".api-key-dot"),
    ).toHaveClass("connected");
    await expect(canvas.getByLabelText("Hardcover API key")).toHaveAttribute(
      "placeholder",
      "hc_l…3f9a",
    );
    await expect(canvas.getByLabelText("Hardcover API key")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(canvas.getByRole("button", { name: "Clear…" })).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Save Hardcover key" }),
    ).toBeEnabled();
    await expect(
      canvas.getByText("Connect Hardcover to power “Readers also enjoyed”."),
    ).toBeInTheDocument();
  },
};

export const HardcoverShowsAKeyThatIsNotConnected: Story = {
  beforeEach({ msw }) {
    msw.use(...secretKeyHandlers(HARDCOVER, NO_KEY, { saved: keys }));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
        "Not connected",
      ),
    );
    await expect(canvas.getByLabelText("Hardcover API key")).toHaveAttribute(
      "placeholder",
      "hc_live_…",
    );
    await expect(
      canvas.queryByTestId("hardcover-clear"),
    ).not.toBeInTheDocument();
  },
};

export const GoogleBooksCarriesItsOwnCopy: Story = {
  args: GOOGLE_BOOKS_ARGS,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Google Books lookup",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Add a Google Books API key so ISBN check-ins keep resolving past the shared anonymous quota.",
      ),
    ).toBeInTheDocument();
    const input = canvas.getByLabelText("Google Books API key");
    await expect(input).toHaveAttribute("id", "google-books-key");
    await expect(input).toHaveAttribute("name", "google_books_api_key");
    await expect(input).toHaveAttribute("placeholder", "AIza…");
    await expect(
      canvas.getByTestId("google-books-key-card"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByTestId("google-books-status")).toHaveTextContent(
        "Not connected",
      ),
    );
    await expect(
      canvas.getByRole("button", { name: "Save Google Books key" }),
    ).toBeEnabled();
  },
};

export const RefusesABlankKey: Story = {
  play: async ({ canvas, userEvent }) => {
    const save = canvas.getByRole("button", { name: "Save Hardcover key" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.type(canvas.getByLabelText("Hardcover API key"), "   ");
    await userEvent.click(save);

    await expect(
      await canvas.findByText("Enter a Hardcover key to save."),
    ).toHaveClass("settings-status", "error");
    await expect(keys).toEqual([]);
  },
};

export const SavesTheKeyTrimmedAndShowsItMasked: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText("Hardcover API key");
    const save = canvas.getByRole("button", { name: "Save Hardcover key" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.type(input, " hc_live_abcdef ");
    await userEvent.click(save);

    await expect(await canvas.findByText("Hardcover key saved.")).toHaveClass(
      "settings-status",
      "success",
    );
    await expect(keys).toEqual(["hc_live_abcdef"]);
    await expect(input).toHaveValue("");
    await expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
      "Connected · settings · hc_l…cdef",
    );
  },
};

export const ShowsASaveRefusalAndKeepsTheTypedKey: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        HARDCOVER,
        () => new HttpResponse("the key is too long", { status: 422 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText("Hardcover API key");
    const save = canvas.getByRole("button", { name: "Save Hardcover key" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.type(input, "hc_live_abcdef");
    await userEvent.click(save);

    await expect(
      await canvas.findByText(
        "Couldn’t save the Hardcover key: the key is too long",
      ),
    ).toHaveClass("settings-status", "error");
    await expect(input).toHaveValue("hc_live_abcdef");
  },
};

let writeGate = deferred();

export const HoldsTheKeySaveWhileSaving: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(HARDCOVER, async () => {
        await writeGate.promise;
        return HttpResponse.json(aWireKeyStatus());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const save = canvas.getByRole("button", { name: "Save Hardcover key" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.type(
      canvas.getByLabelText("Hardcover API key"),
      "hc_live_x",
    );
    await userEvent.click(save);

    await waitFor(() => expect(save).toHaveTextContent("Saving…"));
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByTestId("hardcover-clear")).toBeDisabled();
    writeGate.release();
    await waitFor(() => expect(save).toBeEnabled());
  },
};

export const HoldsSaveButNotBusyWhileClearingTheKey: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(HARDCOVER, async () => {
        await writeGate.promise;
        return HttpResponse.json(NO_KEY);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );
    const dialog = await canvas.findByTestId("hardcover-clear-dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove Hardcover key" }),
    );

    const save = canvas.getByTestId("hardcover-save");
    await waitFor(() => expect(save).toBeDisabled());
    await expect(save).toHaveTextContent("Save Hardcover key");
    await expect(save).toHaveAttribute("aria-busy", "false");
    writeGate.release();
    await waitFor(() => expect(save).toBeEnabled());
  },
};

export const RemovesTheKeyAfterConfirming: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );

    const dialog = await canvas.findByTestId("hardcover-clear-dialog");
    await expect(
      within(dialog).getByRole("heading", {
        name: "Remove the Hardcover key?",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText(
        "“Readers also enjoyed” suggestions stop until a new key is saved. The key can’t be shown again, so you’ll need the original to put it back.",
      ),
    ).toBeInTheDocument();
    await expect(keys).toEqual([]);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove Hardcover key" }),
    );

    await expect(await canvas.findByText("Hardcover key cleared.")).toHaveClass(
      "settings-status",
      "success",
    );
    await expect(keys).toEqual([null]);
    await expect(
      canvas.queryByTestId("hardcover-clear-dialog"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
      "Not connected",
    );
  },
};

export const CancellingTheRemovalKeepsTheKey: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );
    const dialog = await canvas.findByTestId("hardcover-clear-dialog");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await expect(
      canvas.queryByTestId("hardcover-clear-dialog"),
    ).not.toBeInTheDocument();
    await expect(keys).toEqual([]);
    await expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
      "Connected",
    );
  },
};

export const ShowsARemovalRefusalAndClosesTheDialog: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", HARDCOVER, 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );
    const dialog = await canvas.findByTestId("hardcover-clear-dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove Hardcover key" }),
    );

    await expect(
      await canvas.findByText(
        "Couldn’t clear the Hardcover key: failed with 500",
      ),
    ).toHaveClass("settings-status", "error");
    await expect(
      canvas.queryByTestId("hardcover-clear-dialog"),
    ).not.toBeInTheDocument();
  },
};

export const GoogleBooksSaveTellsCheckInAboutTheQuota: Story = {
  args: GOOGLE_BOOKS_ARGS,
  play: async ({ canvas, userEvent }) => {
    const save = canvas.getByRole("button", { name: "Save Google Books key" });
    await waitFor(() => expect(save).toBeEnabled());
    seedQueries([["google-books-configured"]]);
    await userEvent.type(
      canvas.getByLabelText("Google Books API key"),
      "AIzaKey",
    );
    await userEvent.click(save);

    await expect(
      await canvas.findByText("Google Books key saved."),
    ).toBeInTheDocument();
    await expect(keys).toEqual(["AIzaKey"]);
    await expectInvalidated([["google-books-configured"]]);
  },
};

export const GoogleBooksRemovalTellsCheckInAboutTheQuota: Story = {
  args: GOOGLE_BOOKS_ARGS,
  beforeEach({ msw }) {
    msw.use(
      ...secretKeyHandlers(
        GOOGLE_BOOKS,
        aWireKeyStatus({ masked: "AIza…9f3a" }),
        { saved: keys },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );
    const dialog = await canvas.findByTestId("google-books-clear-dialog");
    await expect(
      within(dialog).getByRole("heading", {
        name: "Remove the Google Books key?",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText(/fall back to the shared anonymous quota/),
    ).toBeInTheDocument();
    seedQueries([["google-books-configured"]]);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove Google Books key" }),
    );

    await expect(
      await canvas.findByText("Google Books key cleared."),
    ).toBeInTheDocument();
    await expectInvalidated([["google-books-configured"]]);
  },
};

export const HardcoverSaveLeavesCheckInAlone: Story = {
  play: async ({ canvas, userEvent }) => {
    const save = canvas.getByRole("button", { name: "Save Hardcover key" });
    await waitFor(() => expect(save).toBeEnabled());
    seedQueries([["google-books-configured"]]);
    await userEvent.type(
      canvas.getByLabelText("Hardcover API key"),
      "hc_live_x",
    );
    await userEvent.click(save);

    await canvas.findByText("Hardcover key saved.");
    await expect(
      storyClient().getQueryState(["google-books-configured"])?.isInvalidated,
    ).toBe(false);
  },
};

export const CalibreLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(EBOOK_CONVERT));
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Calibre format conversion",
      }),
    ).toBeInTheDocument();
    const status = canvas.getByTestId("ebook-convert-status");
    await expect(status).toHaveTextContent("Checking…");
    await expect(status.querySelector(".api-key-dot")).toHaveClass("pending");
    await expect(canvas.getByLabelText("ebook-convert path")).toHaveAttribute(
      "placeholder",
      "ebook-convert",
    );
    await expect(
      canvas.queryByRole("button", { name: "Use auto-detection" }),
    ).not.toBeInTheDocument();
  },
};

export const CalibreLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", EBOOK_CONVERT, 500));
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(STATUS_READ_FAILED)).toHaveClass(
      "settings-status",
      "error",
    );
    await expect(canvas.getByTestId("ebook-convert-status")).toHaveTextContent(
      "Status unavailable",
    );
  },
};

export const CalibreShowsTheResolvedPath: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...ebookConvertHandlers(
        aWireEbookConvert({
          path: "/usr/local/bin/ebook-convert",
          source: "env",
        }),
        { saved: paths },
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("ebook-convert-status")).toHaveTextContent(
        "Detected · env · /usr/local/bin/ebook-convert",
      ),
    );
    await expect(
      canvas.getByTestId("ebook-convert-status").querySelector(".api-key-dot"),
    ).toHaveClass("connected");
    await expect(canvas.getByLabelText("ebook-convert path")).toHaveAttribute(
      "placeholder",
      "/usr/local/bin/ebook-convert",
    );
    await expect(
      canvas.queryByRole("button", { name: "Use auto-detection" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Omnibus converts between ebook formats with Calibre’s ebook-convert. Calibre is optional — without it, conversion stays disabled and everything else works as usual.",
      ),
    ).toBeInTheDocument();
  },
};

export const CalibreReportsAMissingBinaryAsNotDetected: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...ebookConvertHandlers(aWireEbookConvert({ available: false }), {
        saved: paths,
      }),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("ebook-convert-status")).toHaveTextContent(
        "Not detected",
      ),
    );
    await expect(
      canvas.getByTestId("ebook-convert-status").querySelector(".api-key-dot"),
    ).not.toHaveClass("connected");
  },
};

export const CalibreOffersAutoDetectionOnlyForASavedPath: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...ebookConvertHandlers(
        aWireEbookConvert({
          path: "/opt/calibre/ebook-convert",
          source: "settings",
        }),
        { saved: paths },
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Use auto-detection" }),
    ).toBeEnabled();
  },
};

export const CalibreRefusesABlankPath: Story = {
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/Detected/);
    await userEvent.click(
      canvas.getByRole("button", { name: "Save ebook-convert path" }),
    );

    await expect(
      await canvas.findByText("Enter a path to ebook-convert to save."),
    ).toHaveClass("settings-status", "error");
    await expect(paths).toEqual([]);
  },
};

export const CalibreSavesAPathTrimmed: Story = {
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/Detected/);
    const input = canvas.getByLabelText("ebook-convert path");
    await userEvent.type(input, " /opt/calibre/ebook-convert ");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save ebook-convert path" }),
    );

    await expect(
      await canvas.findByText("ebook-convert path saved."),
    ).toHaveClass("settings-status", "success");
    await expect(paths).toEqual(["/opt/calibre/ebook-convert"]);
    await expect(input).toHaveValue("");
    await expect(canvas.getByTestId("ebook-convert-status")).toHaveTextContent(
      "Detected · settings · /opt/calibre/ebook-convert",
    );
    await expect(
      canvas.getByRole("button", { name: "Use auto-detection" }),
    ).toBeInTheDocument();
  },
};

export const CalibreWarnsOfASavedPathThatIsNotRunnable: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(EBOOK_CONVERT, () =>
        HttpResponse.json(
          aWireEbookConvert({
            available: false,
            path: "/nope",
            source: "settings",
          }),
        ),
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/Detected/);
    await userEvent.type(canvas.getByLabelText("ebook-convert path"), "/nope");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save ebook-convert path" }),
    );

    await expect(
      await canvas.findByText(
        "Path saved, but ebook-convert is not runnable there.",
      ),
    ).toHaveClass("settings-status", "error");
  },
};

export const CalibreShowsASaveRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        EBOOK_CONVERT,
        () =>
          new HttpResponse("ebook convert path exceeds 4096 bytes", {
            status: 422,
          }),
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/Detected/);
    const input = canvas.getByLabelText("ebook-convert path");
    await userEvent.type(input, "/opt/x");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save ebook-convert path" }),
    );

    await expect(
      await canvas.findByText(
        "Couldn’t save the ebook-convert path: ebook convert path exceeds 4096 bytes",
      ),
    ).toHaveClass("settings-status", "error");
    await expect(input).toHaveValue("/opt/x");
  },
};

export const CalibreClearsTheOverride: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...ebookConvertHandlers(
        aWireEbookConvert({
          path: "/opt/calibre/ebook-convert",
          source: "settings",
        }),
        { saved: paths },
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Use auto-detection" }),
    );

    await expect(
      await canvas.findByText("Override cleared — using auto-detection."),
    ).toHaveClass("settings-status", "success");
    await expect(paths).toEqual([null]);
    await expect(
      canvas.queryByRole("button", { name: "Use auto-detection" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByTestId("ebook-convert-status")).toHaveTextContent(
      "Detected · path · ebook-convert",
    );
  },
};

export const CalibreShowsAClearRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("post", EBOOK_CONVERT, 500),
      ...ebookConvertHandlers(
        aWireEbookConvert({
          path: "/opt/calibre/ebook-convert",
          source: "settings",
        }),
        { saved: paths },
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Use auto-detection" }),
    );

    await expect(
      await canvas.findByText(
        "Couldn’t clear the ebook-convert path: failed with 500",
      ),
    ).toHaveClass("settings-status", "error");
  },
};

export const CalibreHoldsSaveWhileSaving: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(EBOOK_CONVERT, async () => {
        await writeGate.promise;
        return HttpResponse.json(aWireEbookConvert());
      }),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/Detected/);
    await userEvent.type(canvas.getByLabelText("ebook-convert path"), "/opt/x");
    const save = canvas.getByRole("button", {
      name: "Save ebook-convert path",
    });
    await userEvent.click(save);

    await waitFor(() => expect(save).toHaveTextContent("Saving…"));
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    writeGate.release();
    await waitFor(() => expect(save).toBeEnabled());
  },
};

export const CalibreHoldsSaveButNotBusyWhileClearingTheOverride: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(EBOOK_CONVERT, async () => {
        await writeGate.promise;
        return HttpResponse.json(aWireEbookConvert());
      }),
      ...ebookConvertHandlers(
        aWireEbookConvert({
          path: "/opt/calibre/ebook-convert",
          source: "settings",
        }),
        { saved: paths },
      ),
    );
  },
  render: () => <EbookConvertCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Use auto-detection" }),
    );

    const save = canvas.getByTestId("ebook-convert-save");
    await waitFor(() => expect(save).toBeDisabled());
    await expect(save).toHaveTextContent("Save ebook-convert path");
    await expect(save).toHaveAttribute("aria-busy", "false");
    writeGate.release();
    await waitFor(() => expect(save).toBeEnabled());
  },
};

export const McpLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(MCP));
  },
  render: () => <McpCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Hosted MCP endpoint",
      }),
    ).toBeInTheDocument();
    const track = canvas.getByTestId("mcp-toggle");
    await expect(track).not.toHaveAttribute("role");
    await expect(track).not.toHaveAttribute("aria-checked");
    await expect(track).toHaveClass("ld-toggle-unknown");
    await expect(track).toBeDisabled();
    const state = canvas.getByTestId("mcp-toggle-state");
    await expect(state).toHaveTextContent("checking…");
    await expect(state).toHaveClass("ld-sheen");
    await expect(
      canvas.getByText("Checking the endpoint's current state…"),
    ).toBeInTheDocument();
  },
};

export const McpLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", MCP, 500));
  },
  render: () => <McpCard />,
  play: async ({ canvas }) => {
    const status = await canvas.findByTestId("mcp-toggle-status");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveTextContent("failed with 500");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("mcp-toggle")).toBeDisabled();
  },
};

export const McpShowsADisabledEndpoint: Story = {
  render: () => <McpCard />,
  play: async ({ canvas }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Hosted MCP endpoint",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toHaveClass("on");
    await expect(toggle).not.toHaveClass("ld-toggle-unknown");
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "disabled",
    );
    await expect(
      canvas.getByText(
        "/mcp answers 404 until this is on. Instance-wide, and off by default.",
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByText("admin")).toHaveClass("tkx-admin-tag");
  },
};

export const McpShowsAnEnabledEndpoint: Story = {
  beforeEach({ msw }) {
    msw.use(...mcpHandlers(true, { saved: toggles }));
  },
  render: () => <McpCard />,
  play: async ({ canvas }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Hosted MCP endpoint",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toHaveClass("on");
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "enabled",
    );
    await expect(
      canvas.getByText(
        "Serving this library's MCP tools over streamable HTTP at /mcp. Clients authenticate with a token above.",
      ),
    ).toBeInTheDocument();
  },
};

export const McpEnablesTheEndpoint: Story = {
  render: () => <McpCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Hosted MCP endpoint" }),
    );

    await expect(
      await canvas.findByText("MCP endpoint enabled at /mcp."),
    ).toHaveClass("settings-status", "success");
    await expect(toggles).toEqual([true]);
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "enabled",
    );
    await expect(canvas.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};

export const McpDisablesTheEndpoint: Story = {
  beforeEach({ msw }) {
    msw.use(...mcpHandlers(true, { saved: toggles }));
  },
  render: () => <McpCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Hosted MCP endpoint" }),
    );

    await expect(
      await canvas.findByText("MCP endpoint disabled. /mcp now answers 404."),
    ).toHaveClass("settings-status", "success");
    await expect(toggles).toEqual([false]);
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "disabled",
    );
  },
};

export const McpShowsAToggleRefusalAndKeepsTheState: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", MCP, 403));
  },
  render: () => <McpCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Hosted MCP endpoint" }),
    );

    const status = await canvas.findByText("failed with 403");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "disabled",
    );
    await expect(canvas.getByRole("switch")).toBeEnabled();
  },
};

export const McpHoldsTheSwitchWhileSaving: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(MCP, async () => {
        await writeGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => <McpCard />,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Hosted MCP endpoint",
    });
    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeDisabled());
    writeGate.release();
    await waitFor(() => expect(toggle).toBeEnabled());
  },
};

export const McpDrawsAFullSizeCopyButton: Story = {
  render: () => <McpCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("mcp-endpoint-copy"),
    ).toHaveAttribute("class", "btn ghost");
  },
};

export const McpCopiesTheEndpointUrl: Story = {
  beforeEach: () => fakeClipboard(copied),
  render: () => <McpCard />,
  play: async ({ canvas, userEvent }) => {
    const endpoint = `${window.location.origin}/mcp`;
    await expect(
      await canvas.findByTestId("mcp-endpoint-url"),
    ).toHaveTextContent(endpoint);
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await expect(
      await canvas.findByTestId("mcp-endpoint-copy-feedback"),
    ).toHaveTextContent("Copied");
    await expect(copied).toEqual([endpoint]);
  },
};
