import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { expect, fn } from "storybook/test";
import { Field } from "./Field";

// Holds the value the way a form would, and still reports each change.
function LiveField(props: ComponentProps<typeof Field>) {
  const [value, setValue] = useState(props.value);
  return (
    <Field
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

const meta = {
  title: "Components/Field",
  component: Field,
  render: (args) => <LiveField {...args} />,
  args: {
    id: "story-username",
    label: "Username",
    autoComplete: "username",
    value: "",
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByLabelText("Username");

    await userEvent.type(input, "ada");

    await expect(input).toHaveValue("ada");
    await expect(args.onChange).toHaveBeenLastCalledWith("ada");
  },
};

export const Valid: Story = {
  args: {
    label: "Email",
    type: "email",
    value: "ada@example.com",
    valid: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("✓")).toBeInTheDocument();
  },
};

export const Invalid: Story = {
  args: {
    label: "Password",
    type: "password",
    value: "short",
    error: "Use at least 10 characters.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Use at least 10 characters.",
    );
    await expect(canvas.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  },
};

export const WithHint: Story = {
  args: { label: "Kindle email", hint: "Ends in @kindle.com" },
};

export const ErrorHidesHint: Story = {
  args: {
    label: "Kindle email",
    hint: "Ends in @kindle.com",
    error: "Not an email address.",
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByText("Ends in @kindle.com"),
    ).not.toBeInTheDocument();
  },
};

export const WithAction: Story = {
  args: {
    label: "Password",
    type: "password",
    action: <a href="#forgot">Forgot?</a>,
  },
};
