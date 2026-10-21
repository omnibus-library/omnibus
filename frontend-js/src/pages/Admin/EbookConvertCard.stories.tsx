import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import {
  aWireEbookConvert,
  ebookConvertHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { EbookConvertCard } from "./EbookConvertCard";

const EBOOK_CONVERT = "/api/settings/ebook-convert";

const paths: (string | null)[] = [];

const meta = {
  title: "Pages/Admin/EbookConvertCard",
  component: EbookConvertCard,
  beforeEach({ msw }) {
    paths.length = 0;
    msw.use(...ebookConvertHandlers(aWireEbookConvert(), { saved: paths }));
  },
} satisfies Meta<typeof EbookConvertCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const STATUS_READ_FAILED = "Couldn’t read the current status: failed with 500";

export const CalibreLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(EBOOK_CONVERT));
  },
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
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Use auto-detection" }),
    ).toBeEnabled();
  },
};

export const CalibreRefusesABlankPath: Story = {
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

let writeGate = deferred();

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

export const CalibreKeepsAPathTypedWhileSaving: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(EBOOK_CONVERT, async () => {
        await writeGate.promise;
        return HttpResponse.json(aWireEbookConvert());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/Detected/);
    const input = canvas.getByLabelText("ebook-convert path");
    const save = canvas.getByRole("button", {
      name: "Save ebook-convert path",
    });
    await userEvent.type(input, "/opt/first");
    await userEvent.click(save);
    await waitFor(() => expect(save).toHaveTextContent("Saving…"));

    await userEvent.type(input, "/second");
    writeGate.release();

    await waitFor(() => expect(save).toBeEnabled());
    await expect(input).toHaveValue("/opt/first/second");
  },
};

export const CalibreKeepsAPathTypedWhileClearingTheOverride: Story = {
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
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Use auto-detection" }),
    );
    const save = canvas.getByTestId("ebook-convert-save");
    await waitFor(() => expect(save).toBeDisabled());

    const input = canvas.getByLabelText("ebook-convert path");
    await userEvent.type(input, "/opt/typed");
    writeGate.release();

    await expect(
      await canvas.findByText("Override cleared — using auto-detection."),
    ).toBeVisible();
    await expect(input).toHaveValue("/opt/typed");
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
