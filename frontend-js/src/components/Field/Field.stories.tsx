import type { Story, StoryDefault } from "@ladle/react";
import { type ComponentProps, useState } from "react";
import { Field } from "./Field";

export default { title: "Components / Field" } satisfies StoryDefault;

type Look = Omit<ComponentProps<typeof Field>, "value" | "onChange">;

function Live({ initial = "", ...look }: Look & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ maxWidth: 360 }}>
      <Field {...look} value={value} onChange={setValue} />
    </div>
  );
}

export const Neutral: Story = () => (
  <Live id="story-username" label="Username" autoComplete="username" />
);

export const Valid: Story = () => (
  <Live
    id="story-email"
    label="Email"
    type="email"
    autoComplete="email"
    initial="ada@example.com"
    valid
  />
);

export const Invalid: Story = () => (
  <Live
    id="story-password"
    label="Password"
    type="password"
    autoComplete="new-password"
    initial="short"
    error="Use at least 10 characters."
  />
);

export const WithHint: Story = () => (
  <Live
    id="story-kindle"
    label="Kindle email"
    autoComplete="email"
    hint="Ends in @kindle.com"
  />
);

export const WithAction: Story = () => (
  <Live
    id="story-login-password"
    label="Password"
    type="password"
    autoComplete="current-password"
    action={<a href="#forgot">Forgot?</a>}
  />
);
