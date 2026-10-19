import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { expect, fireEvent, fn } from "storybook/test";
import { ChipInput } from "./ChipInput";

const MANY = Array.from({ length: 200 }, (_, i) => ({
  name: `Tag ${i + 1}`,
  count: 1,
}));

const offered = () =>
  [...document.querySelectorAll("datalist option")].map((o) =>
    o.getAttribute("value"),
  );

// Holds the chips the way a form would, and still reports each change.
function LiveChipInput(props: ComponentProps<typeof ChipInput>) {
  const [values, setValues] = useState(props.values);
  return (
    <ChipInput
      {...props}
      values={values}
      onChange={(next) => {
        setValues(next);
        props.onChange(next);
      }}
    />
  );
}

const meta = {
  title: "Components/ChipInput",
  component: ChipInput,
  render: (args) => <LiveChipInput {...args} />,
  args: {
    label: "Add tags",
    values: ["cozy"],
    onChange: fn(),
    suggestions: [
      { name: "Space opera", count: 12 },
      { name: "Cozy", count: 4 },
    ],
    placeholder: "Add a tag to every book…",
    removeLabel: "Remove tag",
  },
} satisfies Meta<typeof ChipInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddByEnter: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole("combobox", { name: "Add tags" });

    await userEvent.type(input, "  slow burn {Enter}");
    await userEvent.type(input, "found family,");

    await expect(canvas.getByText("slow burn")).toBeVisible();
    await expect(canvas.getByText("found family")).toBeVisible();
    await expect(args.onChange).toHaveBeenLastCalledWith([
      "cozy",
      "slow burn",
      "found family",
    ]);
    await expect(input).toHaveValue("");
  },
};

export const AddFromSuggestion: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole("combobox", { name: "Add tags" });
    // The suggestions already on the page leave the list: "Cozy" is a chip.
    await expect(offered()).toEqual(["Space opera"]);

    await fireEvent.input(input, {
      target: { value: "Space opera" },
      inputType: "insertReplacementText",
    });

    await expect(canvas.getByText("Space opera")).toBeVisible();
    await expect(args.onChange).toHaveBeenLastCalledWith([
      "cozy",
      "Space opera",
    ]);
  },
};

export const RemoveChip: Story = {
  args: { values: ["cozy", "slow burn"] },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove tag cozy" }),
    );
    await expect(canvas.queryByText("cozy")).toBeNull();
    await expect(args.onChange).toHaveBeenLastCalledWith(["slow burn"]);

    await userEvent.click(canvas.getByRole("combobox", { name: "Add tags" }));
    await userEvent.keyboard("{Backspace}");
    await expect(canvas.queryByText("slow burn")).toBeNull();
    await expect(args.onChange).toHaveBeenLastCalledWith([]);
  },
};

export const NoDuplicates: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole("combobox", { name: "Add tags" });

    await userEvent.type(input, "COZY{Enter}");
    await userEvent.type(input, "   {Enter}");

    await expect(canvas.getAllByText("cozy")).toHaveLength(1);
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const CapsSuggestions: Story = {
  args: { values: [], suggestions: MANY },
  play: async ({ canvas, userEvent }) => {
    await expect(offered()).toHaveLength(50);

    await userEvent.type(
      canvas.getByRole("combobox", { name: "Add tags" }),
      "tag 19",
    );

    // Only the names containing the draft remain: Tag 19 and Tag 190 to 199.
    await expect(offered()).toHaveLength(11);
  },
};

export const RemovesOnlyTheChipClicked: Story = {
  args: { values: ["Fiction", "Fiction"] },
  play: async ({ canvas, userEvent, args }) => {
    const [first] = canvas.getAllByRole("button", {
      name: "Remove tag Fiction",
    });
    if (!first) throw new Error("no remove button");

    await userEvent.click(first);

    await expect(args.onChange).toHaveBeenLastCalledWith(["Fiction"]);
    await expect(canvas.getAllByText("Fiction")).toHaveLength(1);
  },
};
