import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, fn, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { failing, mergeHandlers } from "../../testing/handlers";
import { aWireBook } from "../../testing/wire";
import { MergeDialog } from "./MergeDialog";

const TARGET = aWireBook({
  title: "Aurora Station",
  series: "Aurora",
  series_index: "1",
  creators: [{ name: "Sora Inkwell", role: null, file_as: null, id: 2 }],
});

const volume = (n: number, overrides: Parameters<typeof aWireBook>[0] = {}) =>
  aWireBook({
    id: 20 + n,
    title: `Aurora Station, Vol. ${n}`,
    unique_identifier: `00000000-0000-4000-8000-00000000000${n}`,
    series: "aurora",
    formats: ["M4B"],
    published: "2022-06-01",
    cover_url: null,
    ...overrides,
  });

const writes: string[] = [];

const meta = {
  title: "Components/MergeDialog",
  component: MergeDialog,
  args: { target: toBookDetail(TARGET), onMerged: fn(), onClose: fn() },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(
      ...mergeHandlers([volume(2), volume(3, { series: "Other" })], writes),
    );
  },
} satisfies Meta<typeof MergeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchesTheLibraryExcludingThisBook: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...mergeHandlers(
        [TARGET, volume(2), volume(3, { series: "Other" })],
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = canvas.getByRole("dialog", {
      name: "Merge with another book",
    });
    await expect(
      within(dialog).getByText("Everything folds into"),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText("Sora Inkwell · Aurora #1"),
    ).toBeInTheDocument();
    await expect(canvas.queryAllByTestId("merge-candidate")).toHaveLength(0);

    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");

    const rows = await canvas.findAllByTestId("merge-candidate");
    // The keeper is not a candidate for itself.
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent("Aurora Station, Vol. 2");
    await expect(rows[0]).toHaveTextContent("Sora Inkwell · 2022");
    await expect(rows[0]).toHaveTextContent("Same series");
    await expect(rows[0]).toHaveTextContent("M4B");
    await expect(rows[1]).not.toHaveTextContent("Same series");
    await expect(canvas.getByText("Results · 2")).toBeInTheDocument();
  },
};

export const ShowsAtMostEightCandidates: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...mergeHandlers(
        Array.from({ length: 11 }, (_, i) =>
          volume(i % 10, {
            id: 100 + i,
            unique_identifier: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
          }),
        ),
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await expect(await canvas.findAllByTestId("merge-candidate")).toHaveLength(
      8,
    );
  },
};

export const PickingOneAsksForConfirmationNamingBoth: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(
      (await canvas.findAllByTestId("merge-candidate"))[0] as HTMLElement,
    );

    await expect(
      canvas.getByText("“Aurora Station, Vol. 2”"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("“Aurora Station”")).toBeInTheDocument();
    await expect(writes).toEqual([]);

    await userEvent.click(canvas.getByTestId("merge-back"));
    await expect(canvas.getByTestId("merge-search")).toBeInTheDocument();
  },
};

export const MergingReportsTheUndoId: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(
      (await canvas.findAllByTestId("merge-candidate"))[0] as HTMLElement,
    );

    await userEvent.click(canvas.getByTestId("merge-confirm"));

    await waitFor(() => expect(args.onMerged).toHaveBeenCalledWith(5));
    await expect(writes).toEqual([
      `merge:00000000-0000-4000-8000-000000000002>${TARGET.unique_identifier}`,
    ]);
  },
};

export const MergeInFlightIsGuardedAndCannotBeDismissed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post("/api/books/merge", async () => {
        await delay(400);
        return HttpResponse.json({ merge_log_id: 5, target_uuid: "x" });
      }),
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(
      (await canvas.findAllByTestId("merge-candidate"))[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("merge-confirm"));

    const confirm = canvas.getByTestId("merge-confirm");
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    await expect(confirm).toHaveTextContent("Merging…");
    await expect(canvas.getByTestId("merge-cancel")).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(args.onMerged).toHaveBeenCalled());
  },
};

export const RefusedMergeShowsTheServersWordsAndCanRetry: Story = {
  beforeEach({ msw }) {
    msw.use(...mergeHandlers([volume(2)], writes, 403));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(
      (await canvas.findAllByTestId("merge-candidate"))[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("merge-confirm"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 403",
    );
    await expect(canvas.getByTestId("merge-confirm")).toBeEnabled();
    await expect(args.onMerged).not.toHaveBeenCalled();
  },
};

export const FailedSearchShowsWhy: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/books/merge/candidates", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
  },
};

export const CancelAndEscapeClose: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("merge-cancel"));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(2));
  },
};
