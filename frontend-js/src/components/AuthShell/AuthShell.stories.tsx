import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { AuthShell, Emphasis } from "./AuthShell";

const noop = () => {};

const meta = {
  title: "Components/AuthShell",
  component: AuthShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AuthShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  args: {
    kicker: "Sign in",
    title: (
      <>
        Welcome <Emphasis>back</Emphasis>
      </>
    ),
    lede: "Continue to your library.",
    children: (
      <form className="auth-form-inner">
        <Banner kind="err" title="Wrong username or password." />
        <Field
          id="shell-username"
          label="Username"
          autoComplete="username"
          value="ada"
          onChange={noop}
        />
        <Field
          id="shell-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value=""
          onChange={noop}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="auth-submit"
        >
          Log in
        </Button>
      </form>
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Welcome back",
    );
    await expect(canvas.getByLabelText("Username")).toHaveValue("ada");
  },
};
