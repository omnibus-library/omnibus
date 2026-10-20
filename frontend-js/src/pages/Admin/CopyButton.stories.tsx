import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { fakeClipboard } from "../../testing/clipboard";
import { CopyButton } from "./CopyButton";

const TEXT = "https://omnibus.test/mcp";
const FAILED = "Couldn’t copy. Select and copy it.";

const copied: string[] = [];

const meta = {
  title: "Pages/Admin/CopyButton",
  component: CopyButton,
  args: { text: TEXT, label: "Copy URL", testId: "copy-url" },
  beforeEach() {
    copied.length = 0;
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// A page with no clipboard API, where the fallback's `execCommand` answers `succeeds`.
function withOnlyExecCommand(succeeds: boolean) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: (command: string) => {
      if (command === "copy" && succeeds) {
        copied.push(document.querySelector("textarea")?.value ?? "");
      }
      return succeeds;
    },
  });
  return () => {
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
  };
}

export const ReportsNothingBeforeACopy: Story = {
  play: async ({ canvas }) => {
    const feedback = canvas.getByTestId("copy-url-feedback");
    await expect(feedback).toHaveAttribute("role", "status");
    await expect(feedback).toBeEmptyDOMElement();
  },
};

export const CopiesWithTheClipboardApi: Story = {
  beforeEach: () => fakeClipboard(copied),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    const feedback = await canvas.findByText("Copied");
    await expect(feedback).toHaveAttribute("data-testid", "copy-url-feedback");
    await expect(feedback).not.toHaveClass("error");
    await expect(copied).toEqual([TEXT]);
  },
};

export const FallsBackToASelectedTextareaWithoutTheClipboardApi: Story = {
  beforeEach: () => withOnlyExecCommand(true),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Copy URL" });
    await userEvent.click(button);

    await expect(await canvas.findByText("Copied")).toBeVisible();
    await expect(copied).toEqual([TEXT]);
    await expect(document.querySelector("textarea")).toBeNull();
    await expect(button).toHaveFocus();
  },
};

export const FallsBackWhenTheClipboardApiRefuses: Story = {
  beforeEach: () => {
    const restore = withOnlyExecCommand(true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
    });
    return restore;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await expect(await canvas.findByText("Copied")).toBeVisible();
    await expect(copied).toEqual([TEXT]);
  },
};

export const ReportsACopyThatFailed: Story = {
  beforeEach: () => withOnlyExecCommand(false),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    const feedback = await canvas.findByText(FAILED);
    await expect(feedback).toHaveClass("copy-feedback", "error");
    await expect(copied).toEqual([]);
  },
};
