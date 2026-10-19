import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import type { CreateShelfRequest } from "../../api/generated/schemas";
import {
  createShelfHandler,
  libraryHandler,
  previewHandler,
} from "../../testing/handlers";
import { aWireLibrary, aWireRulePreview, uuidOf } from "../../testing/wire";
import { CreateShelfModal } from "./CreateShelfModal";

const sent: CreateShelfRequest[] = [];

const meta = {
  title: "Components/CreateShelfModal",
  component: CreateShelfModal,
  args: { onClose: fn(), onCreated: fn() },
  beforeEach({ msw }) {
    sent.length = 0;
    msw.use(
      createShelfHandler(sent),
      previewHandler([], aWireRulePreview()),
      libraryHandler(aWireLibrary(4), 100),
    );
  },
} satisfies Meta<typeof CreateShelfModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateSmart: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole("button", { name: "Smart" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Shelf name" }),
      "Cosy reads",
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Condition value" }),
      "Fantasy",
    );
    await expect(
      await canvas.findByTestId("rule-preview-count"),
    ).toHaveTextContent("2 of 10 match");

    await userEvent.click(canvas.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(args.onCreated).toHaveBeenCalledOnce());
    await expect(sent).toEqual([
      {
        kind: "smart",
        name: "Cosy reads",
        visibility: "private",
        match_mode: "all",
        rules: [{ field: "tag", op: "is", value: "Fantasy" }],
        book_uuids: [],
      },
    ]);
  },
};

export const CreateHandPicked: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Hand-picked" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Shelf name" }),
      "Mine",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Public" }));
    await userEvent.click(
      await canvas.findByTestId(`picker-tile-${uuidOf(1)}`),
    );
    await userEvent.click(canvas.getByTestId(`picker-tile-${uuidOf(3)}`));

    await userEvent.click(canvas.getByRole("button", { name: "Create · 2" }));

    await waitFor(() => expect(args.onCreated).toHaveBeenCalledOnce());
    await expect(sent).toEqual([
      {
        kind: "manual",
        name: "Mine",
        visibility: "public",
        match_mode: null,
        rules: [],
        book_uuids: [uuidOf(1), uuidOf(3)],
      },
    ]);
  },
};

export const CreateConflict: Story = {
  beforeEach({ msw }) {
    msw.use(
      createShelfHandler([], {
        refuse: "You already have a shelf called “Cosy reads”.",
      }),
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Shelf name" }),
      "Cosy reads",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Create" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "You already have a shelf called “Cosy reads”.",
    );
    await expect(args.onCreated).not.toHaveBeenCalled();
    await expect(canvas.getByRole("button", { name: "Create" })).toBeEnabled();
  },
};

export const Cancel: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(sent).toEqual([]);
  },
};
