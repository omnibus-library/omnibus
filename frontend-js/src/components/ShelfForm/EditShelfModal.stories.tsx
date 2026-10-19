import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { toShelfDetail } from "../../api";
import {
  previewHandler,
  type ShelfWrite,
  shelfDetailHandlers,
} from "../../testing/handlers";
import { aWireRulePreview, aWireShelfDetail } from "../../testing/wire";
import { EditShelfModal } from "./EditShelfModal";

const wire = aWireShelfDetail({
  id: 3,
  kind: "smart",
  name: "Cosy reads",
  match_mode: "any",
  rules: [{ field: "tag", op: "is", value: "Fantasy" }],
});

const writes: ShelfWrite[] = [];

const meta = {
  title: "Components/EditShelfModal",
  component: EditShelfModal,
  args: { shelf: toShelfDetail(wire), onClose: fn(), onSaved: fn() },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(
      ...shelfDetailHandlers(wire, [], writes),
      previewHandler([], aWireRulePreview()),
    );
  },
} satisfies Meta<typeof EditShelfModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EditSmart: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      canvas.getByRole("textbox", { name: "Shelf name" }),
    ).toHaveValue("Cosy reads");
    await expect(canvas.getByText("Smart shelf")).toBeInTheDocument();
    await expect(canvas.getByRole("combobox", { name: "Match" })).toHaveValue(
      "any",
    );
    const value = canvas.getByRole("textbox", { name: "Condition value" });
    await expect(value).toHaveValue("Fantasy");

    await userEvent.clear(value);
    await userEvent.type(value, "Mystery");
    await userEvent.click(canvas.getByRole("button", { name: "Public" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes).toEqual([
      {
        op: "patch",
        body: {
          name: "Cosy reads",
          visibility: "public",
          sync_to_kobo: false,
          match_mode: "any",
          rules: [{ field: "tag", op: "is", value: "Mystery" }],
        },
      },
    ]);
  },
};

export const EditKoboOn: Story = {
  args: {
    shelf: toShelfDetail(aWireShelfDetail({ id: 3, kind: "manual" })),
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole("button", { name: "Off" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.queryByRole("combobox", { name: "Match" })).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "On" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes).toEqual([
      {
        op: "patch",
        body: {
          name: "Winter reads",
          visibility: "private",
          sync_to_kobo: true,
        },
      },
    ]);
  },
};

export const EditWishlist: Story = {
  args: {
    shelf: toShelfDetail(
      aWireShelfDetail({ id: 3, kind: "wishlist", name: "Wishlist" }),
    ),
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      canvas.getByText("Wishlist", { selector: ".shelf-badge" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Sync to Kobo")).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes).toEqual([
      { op: "patch", body: { name: "Wishlist", visibility: "private" } },
    ]);
  },
};

export const EditNameRequired: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.clear(canvas.getByRole("textbox", { name: "Shelf name" }));

    await userEvent.click(canvas.getByRole("button", { name: "Save" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Name is required.",
    );
    await expect(writes).toEqual([]);
    await expect(args.onSaved).not.toHaveBeenCalled();
  },
};

export const EditNoRules: Story = {
  args: { shelf: toShelfDetail({ ...wire, rules: [] }) },
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getByRole("textbox", { name: "Condition value" }),
    ).toHaveValue("");

    await userEvent.click(canvas.getByRole("button", { name: "Save" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Add at least one condition.",
    );
    await expect(writes).toEqual([]);
  },
};
