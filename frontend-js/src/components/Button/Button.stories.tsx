import type { Story, StoryDefault } from "@ladle/react";
import { BusyLabel } from "../Loading/Loading";
import {
  Button,
  ButtonLink,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";

export default { title: "Components / Button" } satisfies StoryDefault;

const VARIANTS: ButtonVariant[] = ["default", "primary", "ghost", "bad"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

type PlaygroundProps = {
  label: string;
  variant: ButtonVariant;
  size: ButtonSize;
  disabled: boolean;
};

export const Playground: Story<PlaygroundProps> = ({ label, ...look }) => (
  <Button {...look}>{label}</Button>
);
Playground.args = {
  label: "Check in",
  variant: "default",
  size: "md",
  disabled: false,
};
Playground.argTypes = {
  variant: { options: VARIANTS, control: { type: "select" } },
  size: { options: SIZES, control: { type: "radio" } },
};

export const Variants: Story = () => (
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
);

export const Disabled: Story = () => (
  <Button variant="primary" disabled>
    Add books
  </Button>
);

export const Busy: Story = () => (
  <Button variant="primary" size="lg" disabled aria-busy>
    <BusyLabel busy label="Log in" busyLabel="Logging in…" />
  </Button>
);

export const AsLink: Story = () => (
  <ButtonLink to="/settings" variant="ghost" size="sm">
    Settings
  </ButtonLink>
);
