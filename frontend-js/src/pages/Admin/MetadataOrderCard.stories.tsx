import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  DEFAULT_METADATA_ORDER,
  metadataOrderHandlers,
  type SavedOrder,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { MetadataOrderCard } from "./MetadataOrderCard";

const EBOOK = "/api/settings/metadata-precedence/ebook";
const AUDIOBOOK = "/api/settings/metadata-precedence/audiobook";

const saved: SavedOrder[] = [];

const meta = {
  title: "Pages/Admin/MetadataOrderCard",
  component: MetadataOrderCard,
  beforeEach({ msw }) {
    saved.length = 0;
    msw.use(...metadataOrderHandlers({ saved }));
  },
} satisfies Meta<typeof MetadataOrderCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const DEFAULT_LABELS = [
  "Folder structure",
  "Embedded tags",
  "OPF sidecar",
  "Manual edits (overrides)",
  "Provider match (Hardcover)",
];

const labelsOf = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.firstElementChild?.textContent);

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(EBOOK), hanging(AUDIOBOOK));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("metadata-precedence-loading"),
    ).toHaveTextContent("Reading the saved order…");
    await expect(
      canvas.queryByText("Folder structure"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeDisabled();
  },
};

let ebookReads = 0;
let audiobookGate = deferred();

export const WaitsForBothOrders: Story = {
  beforeEach({ msw }) {
    ebookReads = 0;
    audiobookGate = deferred();
    msw.use(
      http.get(EBOOK, () => {
        ebookReads += 1;
        return HttpResponse.json(DEFAULT_METADATA_ORDER);
      }),
      http.get(AUDIOBOOK, async () => {
        await audiobookGate.promise;
        return HttpResponse.json(DEFAULT_METADATA_ORDER);
      }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(ebookReads).toBe(1));
    await expect(
      canvas.getByTestId("metadata-precedence-loading"),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("list")).not.toBeInTheDocument();
    audiobookGate.release();

    await canvas.findByRole("list", { name: "Ebook library" });
    await expect(
      canvas.getByRole("list", { name: "Audiobook library" }),
    ).toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", EBOOK, 500));
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByText(
      "Couldn’t load the saved order: failed with 500",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("metadata-precedence-loading"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeDisabled();
  },
};

export const TryAgainReadsTheOrdersAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(EBOOK, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(DEFAULT_METADATA_ORDER),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await expect(
      await canvas.findByRole("list", { name: "Ebook library" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("metadata-precedence-status"),
    ).toBeEmptyDOMElement();
    await expect(
      canvas.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  },
};

export const ShowsBothOrders: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Source order" }),
    ).toBeInTheDocument();
    const ebook = await canvas.findByRole("list", { name: "Ebook library" });
    const audiobook = canvas.getByRole("list", { name: "Audiobook library" });
    await expect(labelsOf(ebook)).toEqual(DEFAULT_LABELS);
    await expect(labelsOf(audiobook)).toEqual(DEFAULT_LABELS);
    await expect(
      within(ebook).getByRole("button", { name: "Move Folder structure up" }),
    ).toBeDisabled();
    await expect(
      within(ebook).getByRole("button", {
        name: "Move Provider match (Hardcover) down",
      }),
    ).toBeDisabled();
    await expect(
      within(ebook).getByRole("button", { name: "Move Embedded tags up" }),
    ).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeDisabled();
  },
};

export const MovesASourceToTheTopAndFocusesItsOtherButton: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );

    await expect(labelsOf(ebookList)).toEqual([
      "Embedded tags",
      "Folder structure",
      "OPF sidecar",
      "Manual edits (overrides)",
      "Provider match (Hardcover)",
    ]);
    const announcement = canvas.getByText(
      "Embedded tags moved to position 1 of 5.",
    );
    await expect(announcement).toHaveClass("ld-sr");
    await expect(announcement).toHaveAttribute("role", "status");
    await waitFor(() =>
      expect(
        ebook.getByRole("button", { name: "Move Embedded tags down" }),
      ).toHaveFocus(),
    );
    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeEnabled();
  },
};

export const KeepsFocusOnThePressedButtonMidList: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move OPF sidecar up" }),
    );

    await waitFor(() =>
      expect(
        ebook.getByRole("button", { name: "Move OPF sidecar up" }),
      ).toHaveFocus(),
    );
    await expect(
      canvas.getByText("OPF sidecar moved to position 2 of 5."),
    ).toBeInTheDocument();
  },
};

export const MovesASourceToTheBottomAndFocusesItsOtherButton: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Manual edits (overrides) down" }),
    );

    await waitFor(() =>
      expect(
        ebook.getByRole("button", { name: "Move Manual edits (overrides) up" }),
      ).toHaveFocus(),
    );
    await expect(
      canvas.getByText("Manual edits (overrides) moved to position 5 of 5."),
    ).toBeInTheDocument();
  },
};

export const DisablesSaveOnceAMoveIsUndone: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags down" }),
    );

    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeDisabled();
  },
};

export const SavesOnlyTheChangedList: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save metadata order" }),
    );

    const status = await canvas.findByText("Metadata order saved.");
    await expect(status).toHaveClass("settings-status", "success");
    await expect(saved).toEqual([
      {
        library: "ebook",
        order: [
          "embedded_tags",
          "folder_structure",
          "opf_sidecar",
          "omnibus_overrides",
          "provider_match",
        ],
      },
    ]);
    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeDisabled();
  },
};

export const SavesTheEbookListBeforeTheAudiobookList: Story = {
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    const audiobookList = canvas.getByRole("list", {
      name: "Audiobook library",
    });
    const audiobook = within(audiobookList);
    await userEvent.click(
      audiobook.getByRole("button", { name: "Move OPF sidecar up" }),
    );
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save metadata order" }),
    );

    await expect(
      await canvas.findByText("Metadata order saved."),
    ).toBeVisible();
    await expect(saved.map((write) => write.library)).toEqual([
      "ebook",
      "audiobook",
    ]);
  },
};

export const ShowsTheOrderTheServerAnswered: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(EBOOK, () =>
        HttpResponse.json([...DEFAULT_METADATA_ORDER].reverse()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save metadata order" }),
    );

    await expect(
      await canvas.findByText("Metadata order saved."),
    ).toBeVisible();
    await expect(labelsOf(ebookList)).toEqual([...DEFAULT_LABELS].reverse());
  },
};

let saveGate = deferred();

export const HoldsEveryMoveWhileSaving: Story = {
  beforeEach({ msw }) {
    saveGate = deferred();
    msw.use(
      http.post(EBOOK, async () => {
        await saveGate.promise;
        return HttpResponse.json(DEFAULT_METADATA_ORDER);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save metadata order" }),
    );

    const busy = await canvas.findByRole("button", { name: "Saving…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    for (const move of canvas.getAllByRole("button", { name: /^Move / })) {
      await expect(move).toBeDisabled();
    }
    saveGate.release();
    await expect(
      await canvas.findByText("Metadata order saved."),
    ).toBeVisible();
    await expect(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    ).toBeEnabled();
  },
};

export const NamesTheListTheServerRefused: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        AUDIOBOOK,
        () =>
          new HttpResponse(
            "configure the library path before setting its metadata precedence",
            { status: 409 },
          ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const ebookList = await canvas.findByRole("list", {
      name: "Ebook library",
    });
    const ebook = within(ebookList);
    const audiobookList = canvas.getByRole("list", {
      name: "Audiobook library",
    });
    const audiobook = within(audiobookList);
    await userEvent.click(
      ebook.getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(
      audiobook.getByRole("button", { name: "Move OPF sidecar up" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save metadata order" }),
    );

    const status = await canvas.findByText(
      "Saved the ebook order. Couldn’t save the audiobook order: configure the library path before setting its metadata precedence",
    );
    await expect(status).toHaveClass("settings-status", "error");
    // The refused list keeps the edit, so it can be saved again.
    await expect(labelsOf(audiobookList)).toEqual([
      "Folder structure",
      "OPF sidecar",
      "Embedded tags",
      "Manual edits (overrides)",
      "Provider match (Hardcover)",
    ]);
    await expect(
      canvas.getByRole("button", { name: "Save metadata order" }),
    ).toBeEnabled();
  },
};
