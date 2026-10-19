import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { type BookDetail, toBookDetail } from "../../api";
import { failing, hanging, physicalHandlers } from "../../testing/handlers";
import {
  aWireBook,
  aWireCopy,
  aWireFile,
  aWireWishlist,
  WIRE_ADA,
} from "../../testing/wire";
import { PhysicalCopies, WishlistRow } from "./PhysicalCopies";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const nowSecs = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

// Where the reader lands after a removal that takes the book with it.
function Copies({ book }: { book: BookDetail }) {
  return (
    <>
      <div className="bdmq-copies rx-copies">
        <PhysicalCopies book={book} />
        <WishlistRow book={book} />
      </div>
      <output data-testid="location">{useLocation().pathname}</output>
    </>
  );
}

const withFiles = toBookDetail(
  aWireBook({ formats: ["EPUB"], book_files: [aWireFile()] }),
);
const fileless = toBookDetail(aWireBook({ formats: [], book_files: [] }));

const MINE = aWireCopy({ id: 4, checked_in_at: nowSecs() - 2 * DAY });
const THEIRS = aWireCopy({
  id: 5,
  added_by_user_id: 7,
  added_by_name: "grace",
  isbn: null,
  note: "Second printing",
  checked_in_at: nowSecs() - 3 * 3600,
});
const writes: string[] = [];

const meta = {
  title: "Pages/BookDetail/PhysicalCopies",
  component: Copies,
  args: { book: withFiles },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...physicalHandlers({ copies: [MINE, THEIRS] }, writes));
  },
} satisfies Meta<typeof Copies>;

export default meta;
type Story = StoryObj<typeof meta>;

const NOT_ADMIN = { ...WIRE_ADA, is_admin: false, can_edit: false };

export const AdminSeesEveryCopyAndItsFiler: Story = {
  play: async ({ canvas }) => {
    const [mine, theirs] = await canvas.findAllByTestId("physical-copy-card");
    await expect(mine).toHaveTextContent("Checked in 2 days ago by you");
    await expect(mine).toHaveTextContent("ISBN 9781234567897");
    await expect(theirs).toHaveTextContent("Checked in 3 hours ago by grace");
    await expect(theirs).toHaveTextContent("Second printing");
    await expect(
      within(theirs as HTMLElement).getByTestId("copy-edit-note"),
    ).toHaveTextContent("Edit note");
    await expect(
      within(mine as HTMLElement).getByTestId("copy-edit-note"),
    ).toHaveTextContent("Add a note");
  },
};

export const ReaderChangesOnlyTheirOwnCopy: Story = {
  parameters: { user: NOT_ADMIN },
  play: async ({ canvas }) => {
    const [mine, theirs] = await canvas.findAllByTestId("physical-copy-card");
    await expect(
      within(mine as HTMLElement).getByTestId("copy-delete"),
    ).toBeInTheDocument();
    await expect(
      within(theirs as HTMLElement).queryByTestId("copy-delete"),
    ).not.toBeInTheDocument();
    await expect(
      within(theirs as HTMLElement).queryByTestId("copy-edit-note"),
    ).not.toBeInTheDocument();
  },
};

export const FilerWhoseAccountIsGoneIsLeftOut: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...physicalHandlers({
        copies: [
          aWireCopy({
            added_by_user_id: null,
            added_by_name: null,
            checked_in_at: nowSecs() - 2 * DAY,
          }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("physical-copy-card"),
    ).toHaveTextContent(/Checked in 2 days ago$|Checked in 2 days agoISBN/);
    await expect(
      canvas.getByTestId("physical-copy-card"),
    ).not.toHaveTextContent(" by ");
  },
};

export const NoCopiesRendersNothing: Story = {
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({}));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("add-to-wishlist");
    await expect(
      canvas.queryByTestId("bd-physical-panel"),
    ).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/physical/:uuid/copies"));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByTestId("bd-physical-panel"),
    ).not.toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/physical/:uuid/copies", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("physical-error")).toHaveTextContent(
      "failed with 500",
    );
  },
};

export const SavesANote: Story = {
  play: async ({ canvas, userEvent }) => {
    const [mine] = await canvas.findAllByTestId("physical-copy-card");
    await userEvent.click(
      within(mine as HTMLElement).getByTestId("copy-edit-note"),
    );
    await userEvent.type(canvas.getByLabelText("Edition note"), "  Signed  ");
    await userEvent.click(canvas.getByTestId("copy-note-save"));

    await waitFor(() => expect(writes).toEqual(["note:4:Signed"]));
    await waitFor(() =>
      expect(canvas.queryByLabelText("Edition note")).not.toBeInTheDocument(),
    );
    await expect(
      (await canvas.findAllByTestId("physical-copy-card"))[0],
    ).toHaveTextContent("Signed");
  },
};

export const CancellingANoteWritesNothing: Story = {
  play: async ({ canvas, userEvent }) => {
    const [mine] = await canvas.findAllByTestId("physical-copy-card");
    await userEvent.click(
      within(mine as HTMLElement).getByTestId("copy-edit-note"),
    );
    await userEvent.click(canvas.getByTestId("copy-note-cancel"));

    await expect(
      canvas.queryByLabelText("Edition note"),
    ).not.toBeInTheDocument();
    await expect(writes).toEqual([]);
  },
};

export const RemovesACopyAfterConfirming: Story = {
  play: async ({ canvas, userEvent }) => {
    const [mine] = await canvas.findAllByTestId("physical-copy-card");
    await userEvent.click(
      within(mine as HTMLElement).getByTestId("copy-delete"),
    );

    const dialog = canvas.getByRole("dialog", { name: "Remove this copy?" });
    await userEvent.click(
      within(dialog).getByTestId("copy-delete-modal-cancel"),
    );
    await expect(writes).toEqual([]);

    await userEvent.click(
      within(mine as HTMLElement).getByTestId("copy-delete"),
    );
    await userEvent.click(canvas.getByRole("button", { name: "I sold it" }));

    await waitFor(() => expect(writes).toEqual(["delete-copy:4"]));
    await waitFor(() =>
      expect(canvas.getAllByTestId("physical-copy-card")).toHaveLength(1),
    );
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const RemoveFailsKeepsTheCopyAndTheDialog: Story = {
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/physical/copies/:id", 403));
  },
  play: async ({ canvas, userEvent }) => {
    const [mine] = await canvas.findAllByTestId("physical-copy-card");
    await userEvent.click(
      within(mine as HTMLElement).getByTestId("copy-delete"),
    );
    await userEvent.click(canvas.getByRole("button", { name: "I sold it" }));

    await expect(
      await within(canvas.getByRole("dialog")).findByRole("alert"),
    ).toHaveTextContent("failed with 403");
    await expect(canvas.getAllByTestId("physical-copy-card")).toHaveLength(2);
  },
};

const lastCopy = {
  args: { book: fileless },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({ copies: [MINE] }, writes));
  },
} satisfies Story;

export const LastCopyOfAFilelessBookOffersTheChoice: Story = {
  ...lastCopy,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("copy-delete"));

    const dialog = canvas.getByRole("dialog", {
      name: "Remove your last copy",
    });
    await expect(dialog).toHaveTextContent(
      "Remove it entirely, or keep tracking it on your wishlist?",
    );
    await expect(
      within(dialog).getByTestId("last-copy-remove"),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByTestId("last-copy-wishlist"),
    ).toBeInTheDocument();
  },
};

export const LastCopyWithoutEditRightsCanOnlyMoveToTheWishlist: Story = {
  ...lastCopy,
  parameters: { user: { ...NOT_ADMIN, can_edit: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("copy-delete"));

    const dialog = canvas.getByRole("dialog");
    await expect(dialog).toHaveTextContent(
      "Keep tracking it on your wishlist instead?",
    );
    await expect(
      within(dialog).queryByTestId("last-copy-remove"),
    ).not.toBeInTheDocument();
  },
};

export const LastCopyMovesToTheWishlist: Story = {
  ...lastCopy,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("copy-delete"));
    await userEvent.click(canvas.getByTestId("last-copy-wishlist"));

    await waitFor(() =>
      expect(writes).toEqual(["delete-copy:4", "wishlist:add"]),
    );
    await expect(
      await canvas.findByTestId("wishlist-card"),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const LastCopyRemovesTheBookAndLeaves: Story = {
  ...lastCopy,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("copy-delete"));
    await userEvent.click(canvas.getByTestId("last-copy-remove"));

    await waitFor(() =>
      expect(writes).toEqual(["delete-copy:4", "delete-book"]),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("location")).toHaveTextContent("/"),
    );
  },
};

export const FailedFollowUpLeavesTheCopyGoneAndSaysWhy: Story = {
  ...lastCopy,
  beforeEach({ msw }) {
    msw.use(
      failing("delete", "/api/physical/:uuid", 409),
      ...physicalHandlers({ copies: [MINE] }, writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("copy-delete"));
    await userEvent.click(canvas.getByTestId("last-copy-remove"));

    await expect(await canvas.findByTestId("physical-error")).toHaveTextContent(
      "failed with 409",
    );
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("physical-copy-card"),
    ).not.toBeInTheDocument();
    await expect(writes).toEqual(["delete-copy:4"]);
  },
};

const tracked = (deletesBook = false) =>
  ({
    beforeEach({ msw }) {
      msw.use(
        ...physicalHandlers(
          {
            wishlist: aWireWishlist({
              added_at: nowSecs() - 3 * DAY,
              source: "scan",
            }),
          },
          writes,
          deletesBook,
        ),
      );
    },
  }) satisfies Story;

export const TrackedBookOffersFindAndRemove: Story = {
  ...tracked(),
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("wishlist-card")).toHaveTextContent(
      "Tracking since 3 days ago · added from a scan",
    );
    const find = canvas.getByRole("link", { name: "Find a copy" });
    await expect(find).toHaveAttribute(
      "href",
      "https://www.amazon.com/s?k=9781234567897".replace(
        "9781234567897",
        "Aurora%20Station%2C%20Vol.%201%20Sora%20Inkwell",
      ),
    );
    await expect(find).toHaveAttribute("target", "_blank");

    await userEvent.click(canvas.getByTestId("wishlist-remove"));

    await waitFor(() => expect(writes).toEqual(["wishlist:remove"]));
    await expect(
      await canvas.findByTestId("wishlist-add-card"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("location")).toHaveTextContent("/");
  },
};

export const FindACopySearchesTheIsbnWhenTheBookHasOne: Story = {
  args: {
    book: toBookDetail(aWireBook({ formats: [], isbn13: "9781234567897" })),
  },
  ...tracked(),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Find a copy" }),
    ).toHaveAttribute("href", "https://www.amazon.com/s?k=9781234567897");
  },
};

export const RemovingTheLastWishDeletesTheBookAndLeaves: Story = {
  ...tracked(true),
  parameters: { path: `/books/${UUID}` },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("wishlist-remove"));

    await waitFor(() =>
      expect(canvas.getByTestId("location")).toHaveTextContent(/^\/$/),
    );
  },
};

export const UntrackedBookWithNoCopyCanBeAdded: Story = {
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({}, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByTestId("wishlist-add-card"),
    ).toHaveTextContent("Track this title to find a physical copy later.");
    await userEvent.click(canvas.getByTestId("add-to-wishlist"));

    await waitFor(() => expect(writes).toEqual(["wishlist:add"]));
    await expect(
      await canvas.findByTestId("wishlist-card"),
    ).toBeInTheDocument();
  },
};

export const AddFailsSaysWhy: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("post", "/api/physical/:uuid/wishlist", 404),
      ...physicalHandlers({}),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("add-to-wishlist"));

    await expect(await canvas.findByTestId("wishlist-error")).toHaveTextContent(
      "failed with 404",
    );
    await expect(canvas.getByTestId("add-to-wishlist")).toBeEnabled();
  },
};

export const HeldBookOffersNoWishlist: Story = {
  args: {
    book: toBookDetail(aWireBook({ formats: ["EPUB"], has_physical: true })),
  },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("physical-copy-card");
    await expect(
      canvas.queryByTestId("wishlist-add-card"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("wishlist-card")).not.toBeInTheDocument();
  },
};
