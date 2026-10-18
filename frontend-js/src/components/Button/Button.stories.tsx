import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BusyLabel } from "../Loading/Loading";
import {
  Button,
  ButtonLink,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";

const VARIANTS: ButtonVariant[] = ["default", "primary", "ghost", "bad"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: "Check in" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "inline-radio", options: SIZES },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Check in" }),
    ).toHaveAttribute("type", "button");
  },
};

export const PrimarySmall: Story = {
  args: { variant: "primary", size: "sm" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button")).toHaveAttribute(
      "class",
      "btn primary sm",
    );
  },
};

export const WithModifier: Story = {
  args: { variant: "ghost", className: "lib-load-more" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button")).toHaveAttribute(
      "class",
      "btn ghost lib-load-more",
    );
  },
};

export const Disabled: Story = {
  args: { variant: "primary", disabled: true, children: "Add books" },
};

export const Variants: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      {SIZES.map((size) => (
        <div key={size} style={{ display: "flex", gap: 12 }}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant} {size}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const Busy: Story = {
  render: () => (
    <Button variant="primary" size="lg" disabled aria-busy>
      <BusyLabel busy label="Log in" busyLabel="Logging in…" />
    </Button>
  ),
};

export const AsLink: Story = {
  render: () => (
    <ButtonLink to="/settings" variant="ghost" size="sm">
      Settings
    </ButtonLink>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: "Settings" });
    await expect(link).toHaveAttribute("href", "/settings");
    await expect(link).toHaveAttribute("class", "btn ghost sm");
  },
};
