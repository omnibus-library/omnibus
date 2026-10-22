import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, spyOn, waitFor } from "storybook/test";
import { type EditableBook, toEditableBook } from "../../api";
import {
  anEditableWireBook,
  coverWriteHandlers,
} from "../../testing/metadataHandlers";
import { PREVIEW } from "../../testing/uploadHandlers";
import { CoverEditor, type HeldCover, type StagedCover } from "./CoverEditor";

const wire = anEditableWireBook();
const SCANNED = toEditableBook(wire);
const CUSTOM = toEditableBook(
  anEditableWireBook({ has_override: true, has_cover_override: true }),
);
const NO_COVER = toEditableBook(anEditableWireBook({ cover_url: null }));
const FILE_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

const UPLOADED: string[] = [];
const FETCHED: string[] = [];
// Real PNG bytes: a staged preview that fails to decode drops its <img>.
const PNG = Uint8Array.from(
  atob(PREVIEW.slice(PREVIEW.indexOf(",") + 1)),
  (c) => c.charCodeAt(0),
);
const PICK = () => new File([PNG], "new-cover.png", { type: "image/png" });

/** The sheet's part: it holds the pick for Done, and the book a revert returns. */
function Held({ book }: { book: EditableBook }) {
  const [live, setLive] = useState(book);
  const [held, setHeld] = useState<HeldCover | null>(null);
  return (
    <CoverEditor
      book={live}
      target={{
        kind: "held",
        uuid: live.uuid,
        held,
        onHold: setHeld,
        onReverted: setLive,
      }}
    />
  );
}

function Staged({ preview }: { preview: string | null }) {
  const [staged, setStaged] = useState<StagedCover>({
    source: { kind: "keep" },
    preview,
    originalPreview: preview,
  });
  return (
    <CoverEditor
      book={SCANNED}
      target={{ kind: "staged", staged, onStage: setStaged }}
    />
  );
}

const meta = {
  title: "Pages/BookEdit/CoverEditor",
  component: Held,
  args: { book: SCANNED },
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire));
  },
} satisfies Meta<typeof Held>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Extracted: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(canvas.getByLabelText("Replace cover")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/gif",
    );
    await expect(canvas.getByLabelText("Or paste an image URL")).toBeVisible();
    await expect(
      canvas.queryByTestId("cover-remove-override"),
    ).not.toBeInTheDocument();
  },
};

export const MissingCover: Story = {
  args: { book: NO_COVER },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("cover-hint")).toHaveTextContent(
      "no cover available",
    );
    await expect(
      canvas.queryByRole("img", { name: /^Cover of/ }),
    ).not.toBeInTheDocument();
  },
};

export const CustomCover: Story = {
  args: { book: CUSTOM },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("cover-hint")).toHaveTextContent(
      "custom upload",
    );
    await expect(
      canvas.getByRole("button", { name: "Revert to scanned cover" }),
    ).toBeEnabled();
  },
};

export const RevertsToTheScannedCover: Story = {
  args: { book: CUSTOM },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revert to scanned cover" }),
    );

    await expect(
      await canvas.findByText("Reverted to scanned cover."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(
      canvas.queryByTestId("cover-remove-override"),
    ).not.toBeInTheDocument();
  },
};

export const KeepsTheOverrideWhenRevertFails: Story = {
  args: { book: CUSTOM },
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire, { refuse: "not allowed" }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revert to scanned cover" }),
    );

    await expect(
      await canvas.findByText("Revert failed: not allowed"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "custom upload",
    );
    await expect(canvas.getByTestId("cover-remove-override")).toBeEnabled();
  },
};

export const StagesAPickedImage: Story = {
  render: () => <Staged preview={FILE_COVER} />,
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await userEvent.upload(canvas.getByLabelText("Replace cover"), PICK());

    await expect(await canvas.findByText("Cover staged.")).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "your image · saved with the book",
    );
    await expect(
      canvas.getByTestId("cover-staged-preview").querySelector("img"),
    ).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    // Nothing is written for a staged cover, so the URL form is not offered.
    await expect(
      canvas.queryByLabelText("Or paste an image URL"),
    ).not.toBeInTheDocument();
  },
};

export const UsesTheFilesCoverAgain: Story = {
  render: () => <Staged preview={FILE_COVER} />,
  play: async ({ canvas, userEvent }) => {
    const revoke = spyOn(URL, "revokeObjectURL");
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );
    const picked = canvas
      .getByTestId("cover-staged-preview")
      .querySelector("img")?.src;
    await userEvent.click(
      canvas.getByRole("button", { name: "Use the file’s cover" }),
    );

    await expect(
      await canvas.findByText("Using the file's cover."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(picked));
    revoke.mockRestore();
  },
};

export const StagedWithoutACover: Story = {
  render: () => <Staged preview={null} />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("cover-hint")).toHaveTextContent(
      "no cover available",
    );
  },
};

export const HoldsAPickedImage: Story = {
  beforeEach({ msw }) {
    UPLOADED.length = 0;
    msw.use(...coverWriteHandlers(wire, { uploaded: UPLOADED }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );

    await expect(
      await canvas.findByText("Cover held until Done."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "your image · saved when you press Done",
    );
    await expect(
      canvas.getByTestId("cover-staged-preview").querySelector("img"),
    ).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    // Nothing is written: the owner writes it, when the sheet's Done is pressed.
    await expect(UPLOADED).toEqual([]);
    // The URL form is still on offer, and the scanned-cover revert is not while a pick waits.
    await expect(canvas.getByLabelText("Or paste an image URL")).toBeVisible();
    await expect(canvas.getByTestId("cover-drop-held")).toBeEnabled();
  },
};

export const HoldsAnImageUrl: Story = {
  play: async ({ canvas, userEvent }) => {
    const url = await canvas.findByLabelText("Or paste an image URL");
    // An address that loads, since a preview that fails to decode drops its <img>.
    await userEvent.click(url);
    await userEvent.paste(PREVIEW);

    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "from the web · saved when you press Done",
    );
    await expect(
      canvas.getByTestId("cover-staged-preview").querySelector("img"),
    ).toHaveAttribute("src", PREVIEW);
    await expect(url).toHaveValue("");
  },
};

export const ANewPickReleasesTheEarlierOne: Story = {
  play: async ({ canvas, userEvent }) => {
    const revoke = spyOn(URL, "revokeObjectURL");
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );
    const first = canvas
      .getByTestId("cover-staged-preview")
      .querySelector("img")?.src;

    await userEvent.upload(canvas.getByLabelText("Replace cover"), PICK());

    await waitFor(() => expect(revoke).toHaveBeenCalledWith(first));
    revoke.mockRestore();
  },
};

export const DroppingTheHeldCoverKeepsTheCurrentOne: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );

    await userEvent.click(canvas.getByTestId("cover-drop-held"));

    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(canvas.queryByTestId("cover-drop-held")).toBeNull();
    await expect(
      canvas.getByText("Keeping the current cover."),
    ).toBeInTheDocument();
  },
};

export const HeldRevertsTheScannedCoverAtOnce: Story = {
  args: { book: CUSTOM },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revert to scanned cover" }),
    );

    await expect(
      await canvas.findByText("Reverted to scanned cover."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
  },
};
