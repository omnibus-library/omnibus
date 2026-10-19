import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, spyOn, waitFor } from "storybook/test";
import { type EditableBook, toEditableBook } from "../../api";
import {
  anEditableWireBook,
  coverWriteHandlers,
} from "../../testing/metadataHandlers";
import { CoverEditor, type StagedCover } from "./CoverEditor";

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
const PICK = () => new File(["png"], "new-cover.png", { type: "image/png" });

/** The page's part: it holds the book a write returns and counts the writes. */
function Live({ book }: { book: EditableBook }) {
  const [live, setLive] = useState(book);
  const [bust, setBust] = useState(0);
  return (
    <CoverEditor
      book={live}
      target={{ kind: "live", uuid: live.uuid }}
      bust={bust}
      onApplied={(updated) => {
        setLive(updated);
        setBust((n) => n + 1);
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
      bust={0}
      onApplied={() => {}}
    />
  );
}

const meta = {
  title: "Pages/BookEdit/CoverEditor",
  component: Live,
  args: { book: SCANNED },
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire));
  },
} satisfies Meta<typeof Live>;

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

export const UploadsACover: Story = {
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire, { uploaded: UPLOADED }));
  },
  play: async ({ canvas, userEvent }) => {
    UPLOADED.length = 0;
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );

    await expect(await canvas.findByText("Cover updated.")).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "custom upload",
    );
    await expect(
      canvas.getByRole("img", { name: /^Cover of/ }),
    ).toHaveAttribute("src", `${wire.cover_url}?v=1`);
    await expect(UPLOADED).toEqual(["new-cover.png"]);
  },
};

export const ShowsTheUploadInFlight: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...coverWriteHandlers(wire, {
        gate: new Promise<void>(() => {}),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );

    await expect(
      await canvas.findByText("Uploading new-cover.png…"),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("Replace cover")).toBeDisabled();
  },
};

export const UploadFails: Story = {
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire, { refuse: "not an image" }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Replace cover"),
      PICK(),
    );

    await expect(
      await canvas.findByText("Upload failed: not an image"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
  },
};

export const AppliesAnImageUrl: Story = {
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire, { fetched: FETCHED }));
  },
  play: async ({ canvas, userEvent }) => {
    FETCHED.length = 0;
    await expect(await canvas.findByTestId("cover-url-apply")).toBeDisabled();
    const field = canvas.getByLabelText("Or paste an image URL");
    await userEvent.type(field, "https://images.example.com/c.jpg");
    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await expect(await canvas.findByText("Cover updated.")).toBeInTheDocument();
    await expect(field).toHaveValue("");
    await expect(FETCHED).toEqual(["https://images.example.com/c.jpg"]);
  },
};

export const KeepsTheUrlWhenItFails: Story = {
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(wire, { refuse: "that host is private" }));
  },
  play: async ({ canvas, userEvent }) => {
    const field = await canvas.findByLabelText("Or paste an image URL");
    await userEvent.type(field, "https://10.0.0.1/c.jpg{Enter}");

    await expect(
      await canvas.findByText("Couldn't apply that URL: that host is private"),
    ).toBeInTheDocument();
    await expect(field).toHaveValue("https://10.0.0.1/c.jpg");
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
