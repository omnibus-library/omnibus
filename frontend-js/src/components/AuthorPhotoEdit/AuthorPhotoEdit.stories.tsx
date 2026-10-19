import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import type { AuthorId } from "../../api";
import { authorPhotoHandlers, failing, hanging } from "../../testing/handlers";
import { AuthorPhotoEdit } from "./AuthorPhotoEdit";

const writes: string[] = [];

const meta = {
  title: "Components/AuthorPhotoEdit",
  component: AuthorPhotoEdit,
  args: {
    authorId: 2 as AuthorId,
    authorName: "Susanna Clarke",
    onChange: fn(),
    children: <div className="disc-avatar au-avatar">S</div>,
  },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...authorPhotoHandlers(writes));
  },
} satisfies Meta<typeof AuthorPhotoEdit>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openDialog({
  canvas,
  userEvent,
}: Parameters<NonNullable<Story["play"]>>[0]) {
  await userEvent.click(
    canvas.getByRole("button", { name: "Edit photo for Susanna Clarke" }),
  );
  await canvas.findByRole("dialog", { name: "Edit photo for Susanna Clarke" });
}

export const OpensTheDialog: Story = {
  play: async (context) => {
    await expect(context.canvas.queryByRole("dialog")).not.toBeInTheDocument();

    await openDialog(context);

    await expect(
      context.canvas.getByRole("heading", { name: "Edit photo" }),
    ).toBeInTheDocument();
    await expect(
      context.canvas.getByRole("button", { name: "Use URL" }),
    ).toBeDisabled();
  },
};

export const UrlUpdatesThePhoto: Story = {
  play: async (context) => {
    const { canvas, userEvent, args } = context;
    await openDialog(context);

    await userEvent.type(
      canvas.getByLabelText("Paste image URL"),
      " https://example.com/susanna.jpg ",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Use URL" }));

    await waitFor(() => expect(args.onChange).toHaveBeenCalledOnce());
    await expect(writes).toEqual(["url:https://example.com/susanna.jpg"]);
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

export const UrlFailureKeepsTheDialog: Story = {
  beforeEach({ msw }) {
    msw.use(failing("put", "/api/authors/:id/photo/url", 403));
  },
  play: async (context) => {
    const { canvas, userEvent, args } = context;
    await openDialog(context);

    await userEvent.type(
      canvas.getByLabelText("Paste image URL"),
      "https://example.com/nope.jpg",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Use URL" }));

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "URL failed: failed with 403",
    );
    await expect(args.onChange).not.toHaveBeenCalled();
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const WorkingDisablesTheForm: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/authors/:id/photo/url", "put"));
  },
  play: async (context) => {
    const { canvas, userEvent } = context;
    await openDialog(context);

    await userEvent.type(
      canvas.getByLabelText("Paste image URL"),
      "https://example.com/slow.jpg",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Use URL" }));

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Fetching…",
    );
    await expect(canvas.getByLabelText("Paste image URL")).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Scan for picture" }),
    ).toBeDisabled();

    await userEvent.keyboard("{Escape}");

    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Close" })).toBeDisabled();
  },
};

export const UploadUpdatesThePhoto: Story = {
  play: async (context) => {
    const { canvas, userEvent, args } = context;
    await openDialog(context);

    await userEvent.upload(
      canvas.getByLabelText("Upload from this device"),
      new File(["png"], "susanna.png", { type: "image/png" }),
    );

    await waitFor(() => expect(args.onChange).toHaveBeenCalledOnce());
    await expect(writes).toEqual(["upload:susanna.png"]);
  },
};

export const UploadFailureShowsTheServersWords: Story = {
  beforeEach({ msw }) {
    msw.use(failing("put", "/api/authors/:id/photo", 415));
  },
  play: async (context) => {
    const { canvas, userEvent, args } = context;
    await openDialog(context);

    await userEvent.upload(
      canvas.getByLabelText("Upload from this device"),
      new File(["png"], "susanna.png", { type: "image/png" }),
    );

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Upload failed: failed with 415",
    );
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const ScanFindsAPhoto: Story = {
  play: async (context) => {
    const { canvas, userEvent, args } = context;
    await openDialog(context);

    await userEvent.click(
      canvas.getByRole("button", { name: "Scan for picture" }),
    );

    await waitFor(() => expect(args.onChange).toHaveBeenCalledOnce());
  },
};

export const ScanFindsNothing: Story = {
  beforeEach({ msw }) {
    msw.use(...authorPhotoHandlers(writes, false));
  },
  play: async (context) => {
    const { canvas, userEvent, args } = context;
    await openDialog(context);

    await userEvent.click(
      canvas.getByRole("button", { name: "Scan for picture" }),
    );

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "No photo on Open Library for this author.",
    );
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const ScanFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/authors/:id/photo/scan", 404));
  },
  play: async (context) => {
    const { canvas, userEvent } = context;
    await openDialog(context);

    await userEvent.click(
      canvas.getByRole("button", { name: "Scan for picture" }),
    );

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Scan failed: failed with 404",
    );
  },
};

export const CloseDismissesTheDialog: Story = {
  play: async (context) => {
    const { canvas, userEvent } = context;
    await openDialog(context);

    await userEvent.click(canvas.getByRole("button", { name: "Close" }));

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
