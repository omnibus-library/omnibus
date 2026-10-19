import type { Meta, StoryObj } from "@storybook/react-vite";
import { StrictMode } from "react";
import { Route, Routes } from "react-router";
import { expect, waitFor } from "storybook/test";
import { epubRelocate } from "../../testing/readerGlue";
import { progressHandlers } from "../../testing/readerHandlers";
import { readerFixture, SAVED_CFI, UUID } from "../../testing/readerStory";
import { aWirePosition } from "../../testing/wire";
import { Reader } from "./Reader";

const r = readerFixture();
const { writes, statusWrites, install, inits, opens } = r;

const meta = {
  title: "Pages/Reader",
  component: Reader,
  parameters: { path: `/read/${UUID}` },
  beforeEach: ({ msw }) => r.setup(msw),
  render: () => (
    <Routes>
      <Route path="/read/:uuid" element={<Reader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof Reader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach: () => install({ onInit() {} }),
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("reader-loading")).toHaveTextContent(
      "Finding your place",
    );
    await expect(
      canvas.getByRole("button", { name: "Back to book" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(inits()).toHaveLength(1));
  },
};

export const FailsThenRetries: Story = {
  beforeEach() {
    let tries = 0;
    return install({
      onInit() {
        tries += 1;
        window.__omnibusOnStatus?.(tries === 1 ? "error" : "ready");
      },
    });
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This book couldn’t be loaded.",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
    await expect(inits()).toHaveLength(2);
  },
};

export const ShowsANavErrorNotice: Story = {
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-loading")).toBeNull(),
    );

    window.__omnibusOnStatus?.("nav-error");

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "That section couldn’t be opened.",
    );
    await expect(canvas.getByTestId("reader-viewer")).toBeInTheDocument();

    window.__omnibusOnRelocate?.(epubRelocate({ cfi: "epubcfi(/6/6!/4)" }));

    await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(writes).toHaveLength(1));
  },
};

export const OpensAtTheSavedPosition: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(inits()).toHaveLength(1));

    const [id, url, opts] = inits()[0]?.args ?? [];
    await expect(id).toBe("omnibus-viewer");
    await expect(url).toBe(`/api/ebooks/${UUID}/file`);
    await expect(opts).toMatchObject({
      cfi: SAVED_CFI,
      theme: "dark",
      locationsKey: UUID,
      fontsHref: expect.stringContaining("reader-fonts/reader-fonts.css"),
    });
    await canvas.findByTestId("reader-header-chapter");
    // The restore settle restates the position the server already holds.
    await expect(writes).toEqual([]);
  },
};

export const ShowsTheBookAndItsProgress: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Prologue")).toHaveAttribute(
      "data-testid",
      "reader-header-chapter",
    );

    await expect(canvas.getByTestId("reader-top")).toHaveTextContent(
      "Aurora Station, Vol. 1",
    );
    await expect(canvas.getByTestId("reader-footer")).toHaveTextContent(
      /p\.\s1 of 20\s·\s5%/,
    );
    await expect(
      canvas.getByTestId("reader-chapter-counter"),
    ).toHaveTextContent("Ch 1 of 3");
  },
};

export const OpensAtAPercentOnlyRowsDerivedPosition: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...progressHandlers(
        [
          aWirePosition({
            epub_cfi: null,
            progress_percent: 42,
            derived_epub_cfi: "epubcfi(/6/36!/4/2/1:212)",
          }),
        ],
        writes,
      ),
    );
  },
  play: async () => {
    await waitFor(() => expect(inits()).toHaveLength(1));

    await expect(opens()[0]).toMatchObject({
      cfi: "epubcfi(/6/36!/4/2/1:212)",
    });
  },
};

export const DeepLinkBeatsTheSavedPosition: Story = {
  parameters: {
    path: `/read/${UUID}?file_id=3&cfi=${encodeURIComponent("epubcfi(/6/20!/4/10/1:4)")}`,
  },
  play: async () => {
    await waitFor(() => expect(inits()).toHaveLength(1));

    await expect(inits()[0]?.args[1]).toBe(
      `/api/ebooks/${UUID}/file?file_id=3`,
    );
    await expect(opens()[0]).toMatchObject({ cfi: "epubcfi(/6/20!/4/10/1:4)" });
  },
};

export const IgnoresAForeignDeepLink: Story = {
  parameters: { path: `/read/${UUID}?cfi=pdf:3:1,2,3,4,5,6,7,8` },
  play: async () => {
    await waitFor(() => expect(inits()).toHaveLength(1));

    await expect(opens()[0]).toMatchObject({ cfi: SAVED_CFI });
  },
};

export const SeedsTheFooterAndHoldsTheFirstLanding: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...progressHandlers(
        [aWirePosition({ epub_cfi: null, progress_percent: 42 })],
        writes,
      ),
    );
    return install({ onInit() {} });
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("reader-footer")).toHaveTextContent("~42%"),
    );
    await expect(opens()[0]).toMatchObject({ cfi: null });

    window.__omnibusOnRelocate?.(epubRelocate({ cfi: "epubcfi(/6/2!/4)" }));
    await waitFor(() =>
      expect(canvas.getByTestId("reader-footer")).toHaveTextContent(
        /p\.\s1 of 20/,
      ),
    );
    await expect(writes).toEqual([]);

    window.__omnibusOnRelocate?.(epubRelocate({ cfi: "epubcfi(/6/4!/4)" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await expect(writes[0]).toMatchObject({ epub_cfi: "epubcfi(/6/4!/4)" });
  },
};

export const SavesEveryTurn: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowLeft}");

    await waitFor(() => expect(writes).toHaveLength(3));
    await expect(writes.map((w) => [w.epub_cfi, w.progress_percent])).toEqual([
      ["epubcfi(/6/4!/4/2/1:0)", 10],
      ["epubcfi(/6/6!/4/2/1:0)", 15],
      ["epubcfi(/6/4!/4/2/1:0)", 10],
    ]);
    await expect(writes[0]).toMatchObject({ format: "epub" });
    await expect(r.glue.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(["next", "next", "prev"]),
    );
  },
};

export const GuttersTurnThePage: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(
      canvas.getByRole("button", { name: "Previous page" }),
    );

    await waitFor(() =>
      expect(r.glue.calls.map((c) => c.method)).toContain("prev"),
    );
    await waitFor(() => expect(writes).toHaveLength(1));
  },
};

export const PostsAPositionOnce: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    window.__omnibusOnRelocate?.(epubRelocate({ cfi: SAVED_CFI, echo: true }));
    window.__omnibusOnRelocate?.(epubRelocate({ cfi: "epubcfi(/6/8!/4)" }));
    window.__omnibusOnRelocate?.(epubRelocate({ cfi: "epubcfi(/6/8!/4)" }));
    window.__omnibusOnRelocate?.(
      epubRelocate({ cfi: "epubcfi(/6/8!/4)", pctApprox: true, echo: true }),
    );
    window.__omnibusOnRelocate?.("not json");

    await waitFor(() => expect(writes).toHaveLength(1));
    await expect(writes[0]).toMatchObject({
      epub_cfi: "epubcfi(/6/8!/4)",
      progress_percent: 5,
    });
  },
};

export const TogglesTheChrome: Story = {
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByTestId("reader-header-chapter");
    const surface = canvasElement.querySelector(".rd-surface");

    window.__omnibusOnToggleChrome?.("");
    await waitFor(() => expect(surface).toHaveClass("rd-chrome-hidden"));

    window.__omnibusOnToggleChrome?.("");
    await waitFor(() => expect(surface).not.toHaveClass("rd-chrome-hidden"));
  },
};

export const BackAndEscapeLeaveForTheBook: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.keyboard("{Escape}");

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};

export const LeavesTheGlueClean: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");
    await expect(window.__omnibusOnRelocate).toBeDefined();

    await userEvent.click(canvas.getByRole("button", { name: "Back to book" }));

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(r.glue.calls.map((c) => c.method)).toContain("destroy");
    for (const hook of [
      window.__omnibusOnRelocate,
      window.__omnibusOnStatus,
      window.__omnibusOnToc,
      window.__omnibusOnToggleChrome,
    ]) {
      await expect(hook).toBeUndefined();
    }
  },
};

export const InitsOnceUnderStrictMode: Story = {
  render: () => (
    <StrictMode>
      <Routes>
        <Route path="/read/:uuid" element={<Reader />} />
      </Routes>
    </StrictMode>
  ),
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await expect(inits()).toHaveLength(1);
  },
};

export const GivesTheGlueTheAppTheme: Story = {
  globals: { theme: "sepia" },
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await expect(opens()[0]).toMatchObject({ theme: "sepia" });
    await waitFor(() =>
      expect(r.glue.calls).toContainEqual({
        method: "setTheme",
        args: ["sepia"],
      }),
    );
  },
};

export const MarksTheBookFinishedAtTheEnd: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");
    await expect(statusWrites).toEqual([]);

    window.__omnibusOnRelocate?.(
      epubRelocate({ cfi: "epubcfi(/6/40!/4)", atEnd: true, pct: 99 }),
    );

    await waitFor(() =>
      expect(statusWrites).toEqual([
        expect.objectContaining({ status: "finished" }),
      ]),
    );
    await waitFor(() => expect(writes).toHaveLength(1));
  },
};
