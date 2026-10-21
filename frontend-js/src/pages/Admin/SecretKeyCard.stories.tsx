import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  expectInvalidated,
  seedQueries,
  storyClient,
} from "../../testing/AppHarness";
import {
  aWireKeyStatus,
  NO_KEY,
  secretKeyHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { SecretKeyCard } from "./SecretKeyCard";

const HARDCOVER = "/api/hardcover-key";
const GOOGLE_BOOKS = "/api/google-books-key";

const keys: (string | null)[] = [];

const meta = {
  title: "Pages/Admin/SecretKeyCard",
  component: SecretKeyCard,
  args: { kind: "hardcover" },
  beforeEach({ msw }) {
    keys.length = 0;
    msw.use(
      ...secretKeyHandlers(HARDCOVER, aWireKeyStatus(), { saved: keys }),
      ...secretKeyHandlers(GOOGLE_BOOKS, NO_KEY, { saved: keys }),
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

let readGate = deferred();

export const HardcoverShowsCheckingWhileTryAgainReads: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    readGate = deferred();
    msw.use(
      http.get(HARDCOVER, async () => {
        if (++reads === 1) {
          return new HttpResponse("failed with 500", { status: 500 });
        }
        await readGate.promise;
        return HttpResponse.json(aWireKeyStatus());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
        "Checking…",
      ),
    );
    await expect(
      canvas.queryByText(STATUS_READ_FAILED),
    ).not.toBeInTheDocument();
    readGate.release();
    await waitFor(() =>
      expect(canvas.getByTestId("hardcover-status")).toHaveTextContent(
        "Connected",
      ),
    );
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

export const HardcoverKeepsAKeyTypedWhileSaving: Story = {
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
    const input = canvas.getByLabelText("Hardcover API key");
    const save = canvas.getByRole("button", { name: "Save Hardcover key" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.type(input, "hc_live_first");
    await userEvent.click(save);
    await waitFor(() => expect(save).toHaveTextContent("Saving…"));

    await userEvent.type(input, "_second");
    writeGate.release();

    await expect(await canvas.findByText("Hardcover key saved.")).toBeVisible();
    await expect(input).toHaveValue("hc_live_first_second");
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
