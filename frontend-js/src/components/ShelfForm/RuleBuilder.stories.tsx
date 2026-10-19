import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, waitFor } from "storybook/test";
import type {
  MatchMode,
  RulePreviewRequest,
} from "../../api/generated/schemas";
import { failing, previewHandler } from "../../testing/handlers";
import { aWireRulePreview } from "../../testing/wire";
import { RuleBuilder } from "./RuleBuilder";
import { BLANK_DRAFT, type RuleDraft } from "./rules";

function Harness({
  initial,
  mode = "any",
}: {
  initial: RuleDraft[];
  mode?: MatchMode;
}) {
  const [matchMode, setMatchMode] = useState(mode);
  const [drafts, setDrafts] = useState(initial);
  return (
    <RuleBuilder
      matchMode={matchMode}
      drafts={drafts}
      onMatchMode={setMatchMode}
      onDrafts={setDrafts}
    />
  );
}

const FANTASY: RuleDraft = { ...BLANK_DRAFT, value: "Fantasy" };

const meta = {
  title: "Components/RuleBuilder",
  component: Harness,
  args: { initial: [BLANK_DRAFT] },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoRules: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Add a condition to preview matches."),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("rule-preview-count")).toBeNull();
  },
};

const sent: RulePreviewRequest[] = [];

export const Preview: Story = {
  args: { initial: [FANTASY], mode: "all" },
  beforeEach({ msw }) {
    sent.length = 0;
    msw.use(previewHandler(sent, aWireRulePreview()));
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByTestId("rule-preview-count"),
    ).toHaveTextContent("2 of 10 match");
    await expect(
      canvasElement.querySelectorAll(".shelf-cover-tile"),
    ).toHaveLength(2);
    await expect(sent).toEqual([
      {
        match_mode: "all",
        rules: [{ field: "tag", op: "is", value: "Fantasy" }],
      },
    ]);
  },
};

export const PreviewWaitsForTyping: Story = {
  args: { initial: [FANTASY], mode: "all" },
  beforeEach({ msw }) {
    sent.length = 0;
    msw.use(previewHandler(sent, aWireRulePreview()));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("rule-preview-count");

    await userEvent.type(
      canvas.getByRole("textbox", { name: "Condition value" }),
      " Club",
    );

    await waitFor(() => expect(sent).toHaveLength(2));
    await expect(sent.at(-1)).toEqual({
      match_mode: "all",
      rules: [{ field: "tag", op: "is", value: "Fantasy Club" }],
    });
  },
};

export const Pending: Story = {
  args: { initial: [FANTASY] },
  beforeEach({ msw }) {
    // Fantasy answers; anything typed after it is held.
    msw.use(
      previewHandler([], async (body) =>
        body.rules[0]?.value === "Fantasy"
          ? aWireRulePreview()
          : new Promise<never>(() => {}),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const count = await canvas.findByTestId("rule-preview-count");
    await expect(count.closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "false",
    );

    await userEvent.type(
      canvas.getByRole("textbox", { name: "Condition value" }),
      "s",
    );

    await waitFor(() =>
      expect(
        canvas.getByTestId("rule-preview-count").closest("[aria-busy]"),
      ).toHaveAttribute("aria-busy", "true"),
    );
    await expect(canvas.getByTestId("rule-preview-count")).toHaveTextContent(
      "2 of 10 match",
    );
  },
};

export const WaitingForTheFirstAnswer: Story = {
  args: { initial: [FANTASY] },
  beforeEach({ msw }) {
    msw.use(previewHandler([], () => new Promise<never>(() => {})));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Finding matches"),
    ).toBeInTheDocument();
  },
};

export const PreviewFailing: Story = {
  args: { initial: [FANTASY] },
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/shelves/preview", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t preview these conditions.",
    );
  },
};

export const DateInLast: Story = {
  args: {
    initial: [
      { ...BLANK_DRAFT, field: "date_added", op: "in_last", value: "30" },
    ],
  },
  beforeEach({ msw }) {
    sent.length = 0;
    msw.use(previewHandler(sent, aWireRulePreview()));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getByRole("spinbutton", { name: "Condition value" }),
    ).toHaveValue(30);

    await userEvent.selectOptions(
      canvas.getByRole("combobox", { name: "Condition window" }),
      "weeks",
    );

    await waitFor(() =>
      expect(sent.at(-1)?.rules).toEqual([
        { field: "date_added", op: "in_last", value: "30w" },
      ]),
    );
  },
};

export const StatusField: Story = {
  args: { initial: [FANTASY] },
  beforeEach({ msw }) {
    sent.length = 0;
    msw.use(previewHandler(sent, aWireRulePreview()));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.selectOptions(
      canvas.getByRole("combobox", { name: "Condition field" }),
      "Reading status",
    );

    await expect(
      canvas.getByRole("combobox", { name: "Condition value" }),
    ).toHaveValue("finished");
    await expect(
      canvas
        .getByRole("combobox", { name: "Condition operator" })
        .querySelectorAll("option"),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(sent.at(-1)?.rules).toEqual([
        { field: "status", op: "is", value: "finished" },
      ]),
    );
  },
};

export const RemoveCondition: Story = {
  args: {
    initial: [FANTASY, { ...BLANK_DRAFT, field: "author", value: "Le Guin" }],
  },
  beforeEach({ msw }) {
    msw.use(previewHandler([], aWireRulePreview()));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getAllByRole("button", { name: "Remove condition" }),
    ).toHaveLength(2);

    await userEvent.click(canvas.getByTestId("condition-remove-0"));

    await expect(
      canvas.getAllByRole("combobox", { name: "Condition field" }),
    ).toHaveLength(1);
    await expect(
      canvas.getByRole("combobox", { name: "Condition field" }),
    ).toHaveValue("author");
    await expect(
      canvas.queryByRole("button", { name: "Remove condition" }),
    ).toBeNull();

    await userEvent.click(
      canvas.getByRole("button", { name: "＋ Add condition" }),
    );

    await expect(
      canvas.getAllByRole("combobox", { name: "Condition field" }),
    ).toHaveLength(2);
  },
};
