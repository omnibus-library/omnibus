import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { CopyButton } from "./CopyButton";

const meta = {
  title: "Components/CopyButton",
  component: CopyButton,
  args: {
    text: "https://omnibus.example/kobo/abc123",
    label: "Copy URL",
    testId: "copy-url",
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// Swaps the browser's clipboard for the story's, and puts it back afterwards.
function stubClipboard(
  writeText: ((text: string) => Promise<void>) | undefined,
  execCommand: () => boolean,
) {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const original = document.execCommand;
  Object.defineProperty(navigator, "clipboard", {
    value: writeText && { writeText },
    configurable: true,
  });
  document.execCommand = execCommand;
  return () => {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    document.execCommand = original;
  };
}

const written: string[] = [];

export const Copies: Story = {
  beforeEach() {
    written.length = 0;
    return stubClipboard(
      async (text) => void written.push(text),
      () => false,
    );
  },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByTestId("copy-url-feedback")).toBeEmptyDOMElement();
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await waitFor(() =>
      expect(canvas.getByTestId("copy-url-feedback")).toHaveTextContent(
        "Copied",
      ),
    );
    await expect(written).toEqual([args.text]);
  },
};

export const CopiesThroughASelectedFieldWithoutTheClipboardApi: Story = {
  beforeEach() {
    written.length = 0;
    // The copy command copies what the hidden field holds.
    return stubClipboard(undefined, () => {
      written.push(document.querySelector("textarea")?.value ?? "");
      return true;
    });
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await waitFor(() =>
      expect(canvas.getByTestId("copy-url-feedback")).toHaveTextContent(
        "Copied",
      ),
    );
    await expect(written).toEqual([args.text]);
    await expect(document.querySelector("textarea")).toBeNull();
  },
};

export const CopiesThroughASelectedFieldWhenTheClipboardApiRefuses: Story = {
  beforeEach() {
    written.length = 0;
    return stubClipboard(
      async () => {
        throw new Error("denied");
      },
      () => {
        written.push(document.querySelector("textarea")?.value ?? "");
        return true;
      },
    );
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await waitFor(() =>
      expect(canvas.getByTestId("copy-url-feedback")).toHaveTextContent(
        "Copied",
      ),
    );
    await expect(written).toEqual([args.text]);
  },
};

export const SaysWhenTheCopyFailed: Story = {
  beforeEach: () =>
    stubClipboard(
      async () => {
        throw new Error("denied");
      },
      () => false,
    ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await waitFor(() =>
      expect(canvas.getByTestId("copy-url-feedback")).toHaveTextContent(
        "Couldn’t copy. Select and copy it.",
      ),
    );
    await expect(canvas.getByTestId("copy-url-feedback")).toHaveClass("error");
  },
};
