import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { parseBookUuid } from "../../api";
import { deletionHandlers, failing, hanging } from "../../testing/handlers";
import { aWireCopy, aWireFile, aWireManifest } from "../../testing/wire";
import { DeleteBookDialog } from "./DeleteBookDialog";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
if (!UUID) throw new Error("fixture uuid");

const writes: string[] = [];
const TWO_FILES = aWireManifest({
  files: [
    aWireFile({ id: 11, path: "sora/aurora.epub", label: "First edition" }),
    aWireFile({
      id: 12,
      format: "M4B",
      filename: "aurora.m4b",
      size_bytes: 512_000_000,
      path: null,
    }),
  ],
});
const WITH_COPY = aWireManifest({
  ...TWO_FILES,
  copies: [aWireCopy({ id: 9, note: null, isbn: "9781234567897" })],
  impact: { ...aWireManifest().impact, highlights: 3, ratings: 1 },
});

const meta = {
  title: "Components/DeleteBookDialog",
  component: DeleteBookDialog,
  args: { uuid: UUID, title: "Aurora Station", onDeleted: fn(), onClose: fn() },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...deletionHandlers(TWO_FILES, writes));
  },
} satisfies Meta<typeof DeleteBookDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoadingTheManifest: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/books/:uuid/deletion-manifest"));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Loading this book’s files…"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("delete-cancel")).toBeEnabled();
  },
};

export const EscapeClosesOnceTheManifestLoads: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await canvas.findByTestId("delete-file-11");
    await waitFor(() => expect(canvas.getByRole("dialog")).toHaveFocus());
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

export const ManifestFailureSaysSo: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/books/:uuid/deletion-manifest", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.queryByText("Loading this book’s files…"),
    ).not.toBeInTheDocument();
  },
};

export const ListsEveryFileWithItsSizeAndPath: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Delete files from “Aurora Station”?"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("2 FILES ON DISK")).toBeInTheDocument();
    const first = canvas
      .getByTestId("delete-file-11")
      .closest("li") as HTMLElement;
    await expect(first).toHaveTextContent("EPUB");
    await expect(first).toHaveTextContent("First edition");
    await expect(first).toHaveTextContent("3.1 MB · sora/aurora.epub");
    await expect(
      canvas.getByTestId("delete-file-12").closest("li"),
    ).toHaveTextContent("aurora.m4b");
    await expect(canvas.getByTestId("delete-continue")).toBeDisabled();
    await expect(canvas.getByTestId("delete-continue")).toHaveTextContent(
      "Delete files…",
    );
  },
};

export const ListsPhysicalCopiesBelow: Story = {
  beforeEach({ msw }) {
    msw.use(...deletionHandlers(WITH_COPY, writes));
  },
  play: async ({ canvas }) => {
    await canvas.findByText("PHYSICAL COPIES");
    await expect(canvas.getByText("FILES ON DISK")).toBeInTheDocument();
    const row = canvas
      .getByTestId("delete-copy-9")
      .closest("li") as HTMLElement;
    await expect(row).toHaveTextContent("OWN");
    await expect(row).toHaveTextContent("Physical copy");
    await expect(row).toHaveTextContent("ISBN 9781234567897 · no file on disk");
    await expect(
      canvas.getByText(
        "Book record is removed only when every item here is selected.",
      ),
    ).toBeInTheDocument();
  },
};

export const SelectAllToggles: Story = {
  play: async ({ canvas, userEvent }) => {
    const all = await canvas.findByTestId("delete-select-all");
    await userEvent.click(all);
    await expect(canvas.getByTestId("delete-file-11")).toBeChecked();
    await expect(canvas.getByTestId("delete-file-12")).toBeChecked();
    await expect(all).toHaveTextContent("Clear selection");
    await expect(canvas.getByTestId("delete-continue")).toHaveTextContent(
      "Delete 2 files…",
    );

    await userEvent.click(all);
    await expect(canvas.getByTestId("delete-file-11")).not.toBeChecked();
    await expect(all).toHaveTextContent("Select all");
  },
};

export const PartialDeleteKeepsTheBookAndRefetches: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("delete-file-11"));
    await userEvent.click(canvas.getByTestId("delete-continue"));

    await expect(canvas.getByText("Delete 1 file?")).toBeInTheDocument();
    await expect(canvas.getByTestId("delete-confirm-copy")).toHaveTextContent(
      "“First edition” will be deleted from disk and removed from this book. Aurora Station stays in your library with its 1 remaining file.",
    );
    await expect(canvas.queryByTestId("delete-losses")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await waitFor(() => expect(args.onDeleted).toHaveBeenCalledWith(false));
    await expect(writes).toEqual(["delete:files=11;copies="]);
  },
};

export const TotalDeleteNamesTheLossesAndTakesTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(...deletionHandlers(WITH_COPY, writes, true));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("delete-select-all"));
    await userEvent.click(canvas.getByTestId("delete-continue"));

    await expect(canvas.getByText("Delete all 3 items?")).toBeInTheDocument();
    await expect(canvas.getByTestId("delete-losses")).toHaveTextContent(
      "Also deleted: 3 highlights, 1 rating.",
    );
    await expect(canvas.getByTestId("delete-confirm")).toHaveTextContent(
      "Delete book",
    );

    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await waitFor(() => expect(args.onDeleted).toHaveBeenCalledWith(true));
    await expect(writes).toEqual(["delete:files=11,12;copies=9"]);
  },
};

export const BackReturnsToTheChecklistKeepingTheSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("delete-file-12"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-back"));

    await expect(canvas.getByTestId("delete-file-12")).toBeChecked();
  },
};

export const RecordWithNothingOnDiskGoesStraightToConfirm: Story = {
  beforeEach({ msw }) {
    msw.use(...deletionHandlers(aWireManifest({ files: [] }), writes, true));
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(await canvas.findByTestId("delete-confirm")).toHaveTextContent(
      "Delete record",
    );
    await expect(canvas.queryByTestId("delete-back")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("delete-confirm-copy")).toHaveTextContent(
      "removes the library record only",
    );

    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await waitFor(() => expect(args.onDeleted).toHaveBeenCalledWith(true));
    await expect(writes).toEqual(["delete:files=;copies="]);
  },
};

export const DeleteInFlightIsGuardedAndCannotBeDismissed: Story = {
  beforeEach({ msw }) {
    msw.use(...deletionHandlers(TWO_FILES, writes, false, 400));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("delete-file-11"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-confirm"));

    const confirm = canvas.getByTestId("delete-confirm");
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveTextContent("Deleting…");
    await expect(canvas.getByTestId("delete-cancel")).toBeDisabled();
    // Aim at the dialog itself: a disabled button takes the keys of nobody.
    canvas.getByRole("dialog").focus();
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(args.onDeleted).toHaveBeenCalled());
  },
};

export const FailedDeleteKeepsTheDialogOpenWithTheReason: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/books/:uuid/delete-files", 422));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("delete-file-11"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await expect(
      await within(canvas.getByRole("dialog")).findByRole("alert"),
    ).toHaveTextContent("failed with 422");
    await expect(canvas.getByTestId("delete-confirm")).toBeEnabled();
    await expect(args.onDeleted).not.toHaveBeenCalled();
  },
};
