import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor } from "storybook/test";
import { readerFixture, UUID } from "../../testing/readerStory";
import { Reader } from "./Reader";

const r = readerFixture();

const meta = {
  title: "Pages/Reader/Aa panel",
  component: Reader,
  parameters: { path: `/read/${UUID}` },
  beforeEach: ({ msw }) => r.setup(msw),
  render: () => (
    <Routes>
      <Route path="/read/:uuid" element={<Reader />} />
    </Routes>
  ),
} satisfies Meta<typeof Reader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens the panel once the book is up. */
async function openPanel({
  canvas,
  userEvent,
}: Pick<Parameters<NonNullable<Story["play"]>>[0], "canvas" | "userEvent">) {
  await canvas.findByTestId("reader-header-chapter");
  await userEvent.click(
    canvas.getByRole("button", { name: "Display settings" }),
  );
  return canvas.findByTestId("reader-aa-panel");
}

const calls = (method: string) =>
  r.glue.calls.filter((c) => c.method === method).map((c) => c.args);

export const OpensAndClosesFromTheAaButton: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await openPanel({ canvas, userEvent });

    // The panel's scrim covers the surface, so the bar lifts over it for Aa to close it.
    await expect(canvas.getByTestId("reader-top")).toHaveClass(
      "rd-top-over-scrim",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Display settings" }),
    );

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-aa-panel")).toBeNull(),
    );
    await expect(canvas.getByTestId("reader-top")).not.toHaveClass(
      "rd-top-over-scrim",
    );

    await userEvent.click(
      canvas.getByRole("button", { name: "Display settings" }),
    );
    await canvas.findByTestId("reader-aa-panel");
    const scrim = canvasElement.querySelector<HTMLElement>(".rd-scrim");
    if (!scrim) throw new Error("the panel drew no scrim");
    await userEvent.click(scrim);
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-aa-panel")).toBeNull(),
    );
  },
};

export const SizeStepsAndIsRemembered: Story = {
  play: async ({ canvas, userEvent }) => {
    await openPanel({ canvas, userEvent });

    await userEvent.click(
      canvas.getByRole("button", { name: "Increase font size" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Decrease font size" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Decrease font size" }),
    );

    await waitFor(() =>
      expect(calls("setFontSize")).toEqual([[19], [18], [17]]),
    );
    await expect(localStorage.getItem("omn.fontSize")).toBe("17");
  },
};

export const TypefaceReachesTheGlue: Story = {
  play: async ({ canvas, userEvent }) => {
    await openPanel({ canvas, userEvent });
    const mono = canvas.getByTestId("reader-typeface-mono");

    await userEvent.click(mono);

    await expect(mono).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getByTestId("reader-typeface-original"),
    ).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(calls("setFont")).toEqual([
        ["ui-monospace,'SF Mono',Menlo,Consolas,monospace"],
      ]),
    );
    await expect(localStorage.getItem("omn.typeface")).toBe("mono");

    await userEvent.click(canvas.getByTestId("reader-typeface-original"));

    // Original is no override, which reaches the glue as null.
    await waitFor(() => expect(calls("setFont").at(-1)).toEqual([null]));
    await expect(localStorage.getItem("omn.typeface")).toBe("original");
  },
};

export const SpacingMarginsAndPageViewReachTheGlue: Story = {
  play: async ({ canvas, userEvent }) => {
    await openPanel({ canvas, userEvent });

    await userEvent.click(canvas.getByRole("button", { name: "Airy" }));
    await userEvent.click(canvas.getByRole("button", { name: "Wide" }));
    await userEvent.click(canvas.getByTestId("reader-spread-single"));

    await waitFor(() => expect(calls("setSpread")).toEqual([["none"]]));
    await expect(calls("setLineHeight")).toEqual([["2.0"]]);
    await expect(calls("setMargins")).toEqual([
      ["min(65%, calc(100% - 172px))"],
    ]);
    await expect(canvas.getByRole("button", { name: "Airy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(localStorage.getItem("omn.lineSpacing")).toBe("airy");
    await expect(localStorage.getItem("omn.margins")).toBe("wide");
    await expect(localStorage.getItem("omn.spread")).toBe("single");
  },
};

export const JustifyToggles: Story = {
  play: async ({ canvas, userEvent }) => {
    await openPanel({ canvas, userEvent });
    const justify = canvas.getByRole("switch", { name: "Justify text" });
    await expect(justify).toHaveAttribute("aria-checked", "false");

    await userEvent.click(justify);

    await expect(justify).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(calls("setJustify")).toEqual([[true]]));
    await expect(localStorage.getItem("omn.justify")).toBe("true");
  },
};

export const ThemeButtonsSwitchTheApp: Story = {
  play: async ({ canvas, userEvent }) => {
    await openPanel({ canvas, userEvent });
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Sepia" }));

    await expect(canvas.getByRole("button", { name: "Sepia" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(r.glue.calls).toContainEqual({
        method: "setTheme",
        args: ["sepia"],
      }),
    );
    await expect(localStorage.getItem("omn.theme")).toBe("sepia");
  },
};

export const SavedChoicesReachTheFirstInit: Story = {
  beforeEach() {
    localStorage.setItem("omn.fontSize", "24");
    localStorage.setItem("omn.typeface", "classic");
    localStorage.setItem("omn.lineSpacing", "tight");
    localStorage.setItem("omn.margins", "narrow");
    localStorage.setItem("omn.justify", "true");
    localStorage.setItem("omn.spread", "single");
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(r.inits()).toHaveLength(1));

    await expect(r.opens()[0]).toMatchObject({
      fontSize: 24,
      fontFamily: "'EB Garamond',Georgia,serif",
      lineHeight: "1.4",
      maxWidth: "min(95%, calc(100% - 172px))",
      justify: true,
      spread: "none",
    });

    await openPanel({ canvas, userEvent });
    await expect(canvas.getByTestId("reader-typeface-classic")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      canvas.getByRole("switch", { name: "Justify text" }),
    ).toHaveAttribute("aria-checked", "true");
  },
};

export const EscapeClosesThePanelFirst: Story = {
  play: async ({ canvas, userEvent }) => {
    await openPanel({ canvas, userEvent });

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-aa-panel")).toBeNull(),
    );
    await expect(canvas.getByTestId("reader-top")).toBeVisible();
  },
};
