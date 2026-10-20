import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { type Settings, settingsQuery } from "../../api";
import { storyClient } from "../../testing/AppHarness";
import {
  aWireLibraryContents,
  aWireLibrarySection,
  aWireSettings,
  libraryContentsHandler,
  settingsHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { SourcesCard } from "./SourcesCard";

const saved: Settings[] = [];

const meta = {
  title: "Pages/Admin/SourcesCard",
  component: SourcesCard,
  beforeEach({ msw }) {
    saved.length = 0;
    msw.use(
      ...settingsHandlers(aWireSettings(), { saved }),
      libraryContentsHandler(aWireLibraryContents),
    );
  },
} satisfies Meta<typeof SourcesCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/settings"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Library folders" }),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("Ebook library path")).toHaveValue("");
    await expect(
      canvas.getByRole("button", { name: "Save library settings" }),
    ).toBeDisabled();
    // The line is in the page before it has anything to say.
    await expect(canvas.getByTestId("settings-status")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(canvas.getByTestId("settings-status")).toBeEmptyDOMElement();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/settings", 500));
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByText(
      "Couldn’t load the saved settings: failed with 500",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(status).toHaveAttribute("role", "status");
    await expect(
      canvas.getByRole("button", { name: "Save library settings" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  },
};

export const TryAgainReadsTheSettingsAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/settings", () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireSettings()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await waitFor(() =>
      expect(canvas.getByLabelText("Ebook library path")).toHaveValue(
        "/library/ebooks",
      ),
    );
    await expect(canvas.getByTestId("settings-status")).toBeEmptyDOMElement();
    await expect(
      canvas.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Save library settings" }),
    ).toBeEnabled();
  },
};

export const KeepsTheLoadedSettingsWhenALaterReadFails: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/settings", () =>
        ++reads === 1
          ? HttpResponse.json(aWireSettings())
          : new HttpResponse("failed with 500", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const ebook = canvas.getByLabelText("Ebook library path");
    await waitFor(() => expect(ebook).toHaveValue("/library/ebooks"));
    await storyClient().refetchQueries({ queryKey: settingsQuery.queryKey });

    await waitFor(() =>
      expect(storyClient().getQueryState(settingsQuery.queryKey)?.status).toBe(
        "error",
      ),
    );
    await expect(canvas.getByTestId("settings-status")).toBeEmptyDOMElement();
    await expect(
      canvas.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    await expect(ebook).toHaveValue("/library/ebooks");
  },
};

export const Loaded: Story = {
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("Ebook library path")).toHaveValue(
        "/library/ebooks",
      ),
    );
    await expect(canvas.getByLabelText("Audiobook library path")).toHaveValue(
      "/library/audiobooks",
    );
    await expect(
      canvas.getByLabelText("Automatic rescan interval (hours)"),
    ).toHaveValue(24);
    await expect(
      await canvas.findByText("5 files found. 4 .epub found. 1 .pdf found."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("audiobook-library-summary"),
    ).toHaveTextContent("2 files found. 2 .m4b found.");
    await expect(
      canvas.getByRole("button", { name: "Save library settings" }),
    ).toBeEnabled();
  },
};

export const FolderSummaries: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryContentsHandler(() =>
        aWireLibraryContents({
          ebooks: aWireLibrarySection({ path: null, total_files: 0 }),
          audiobooks: aWireLibrarySection({
            path: "/missing",
            error: "No such file or directory",
          }),
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const audiobooks = await canvas.findByText(
      "Couldn’t read this folder: No such file or directory",
    );
    await expect(audiobooks).toHaveClass("library-summary", "error");
    const ebooks = canvas.getByTestId("ebook-library-summary");
    await expect(ebooks).toBeEmptyDOMElement();
    await expect(ebooks).toHaveClass("library-summary", "empty");
  },
};

export const SavesTheSettings: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryContentsHandler(() =>
        saved.length
          ? aWireLibraryContents({
              ebooks: aWireLibrarySection({
                path: "/new/ebooks",
                total_files: 9,
                counts_by_ext: [["epub", 9]],
              }),
            })
          : aWireLibraryContents(),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const ebook = canvas.getByLabelText("Ebook library path");
    await waitFor(() => expect(ebook).toHaveValue("/library/ebooks"));
    await userEvent.clear(ebook);
    await userEvent.type(ebook, " /new/ebooks ");
    const interval = canvas.getByLabelText("Automatic rescan interval (hours)");
    await userEvent.clear(interval);
    await userEvent.type(interval, "6");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save library settings" }),
    );

    const status = await canvas.findByText("Library settings saved.");
    await expect(status).toHaveClass("settings-status", "success");
    await expect(saved).toEqual([
      {
        ebook_library_path: "/new/ebooks",
        audiobook_library_path: "/library/audiobooks",
        scan_interval_hours: 6,
      },
    ]);
    await expect(ebook).toHaveValue(" /new/ebooks ");
    await expect(interval).toHaveValue(6);
    // The summaries are read again, so they describe the new folder.
    await expect(
      await canvas.findByText("9 files found. 9 .epub found."),
    ).toBeInTheDocument();
  },
};

export const SavesBlankFieldsAsNull: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebook = canvas.getByLabelText("Ebook library path");
    await waitFor(() => expect(ebook).toHaveValue("/library/ebooks"));
    await userEvent.clear(ebook);
    await userEvent.clear(
      canvas.getByLabelText("Automatic rescan interval (hours)"),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save library settings" }),
    );

    await expect(
      await canvas.findByText("Library settings saved."),
    ).toBeVisible();
    await expect(saved).toEqual([
      {
        ebook_library_path: null,
        audiobook_library_path: "/library/audiobooks",
        scan_interval_hours: null,
      },
    ]);
  },
};

let saveGate = deferred();

export const HoldsTheButtonWhileSaving: Story = {
  beforeEach({ msw }) {
    saveGate = deferred();
    msw.use(
      http.post("/api/settings", async () => {
        await saveGate.promise;
        return HttpResponse.json(aWireSettings());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Save library settings" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save library settings" }),
    );

    const button = await canvas.findByRole("button", { name: "Saving…" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    saveGate.release();
    await expect(
      await canvas.findByText("Library settings saved."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save library settings" }),
    ).toBeEnabled();
  },
};

export const RefusesABadInterval: Story = {
  play: async ({ canvas, userEvent }) => {
    const interval = canvas.getByLabelText("Automatic rescan interval (hours)");
    await waitFor(() => expect(interval).toHaveValue(24));
    await userEvent.clear(interval);
    await userEvent.type(interval, "1.5");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save library settings" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Enter a whole number of hours, or leave it blank.",
    );
    await expect(interval).toHaveAttribute("aria-invalid", "true");
    await expect(saved).toEqual([]);
  },
};

export const ShowsASaveRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/settings", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Save library settings" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save library settings" }),
    );

    const status = await canvas.findByText(
      "Couldn’t save the library settings: failed with 500",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Save library settings" }),
    ).toBeEnabled();
  },
};
