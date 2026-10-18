import type { Story, StoryDefault } from "@ladle/react";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { AuthShell, Emphasis } from "./AuthShell";

export default { title: "Components / AuthShell" } satisfies StoryDefault;

const noop = () => {};

export const SignIn: Story = () => (
  <AuthShell
    kicker="Sign in"
    title={
      <>
        Welcome <Emphasis>back</Emphasis>
      </>
    }
    lede="Continue to your library."
  >
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
      <Button type="submit" variant="primary" size="lg" className="auth-submit">
        Log in
      </Button>
    </form>
  </AuthShell>
);
