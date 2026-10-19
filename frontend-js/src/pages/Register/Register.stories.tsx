import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes, useLocation } from "react-router";
import { expect } from "storybook/test";
import {
  hanging,
  registerHandler,
  registrationHandler,
} from "../../testing/handlers";
import { Register } from "./Register";

// Prints where the router is, so a story can assert where sign-up led.
function Location() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}

const meta = {
  title: "Pages/Register",
  component: Register,
  parameters: { user: null, path: "/register" },
  render: () => (
    <Routes>
      <Route path="/register" element={<Register />} />
      <Route path="*" element={<Location />} />
    </Routes>
  ),
  beforeEach({ msw }) {
    msw.use(registerHandler());
  },
} satisfies Meta<typeof Register>;

export default meta;
type Story = StoryObj<typeof meta>;

const PASSWORD = "AbCdEfGh1!2x";

export const CheckingRegistration: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/auth/registration"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Checking whether registration is open…",
    );
  },
};

export const Closed: Story = {
  beforeEach({ msw }) {
    msw.use(registrationHandler(false));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Registration is closed"),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  },
};

export const CreatesAccount: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Username"), "grace");
    await userEvent.type(canvas.getByLabelText("Password"), PASSWORD);

    await userEvent.click(
      canvas.getByRole("button", { name: "Create account" }),
    );

    await expect(
      await canvas.findByRole("status", { name: "Location" }),
    ).toHaveTextContent(/^\/$/);
  },
};

export const TakenUsername: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Username"), "taken");
    await userEvent.type(canvas.getByLabelText("Password"), PASSWORD);

    await userEvent.click(
      canvas.getByRole("button", { name: "Create account" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "username already taken",
    );
    await expect(canvas.getByLabelText("Username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      canvas.getByRole("button", { name: "Fix to continue" }),
    ).toBeDisabled();
  },
};

export const RatesPassword: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Password"), PASSWORD);

    await expect(
      canvas.getByRole("meter", { name: "Password strength" }),
    ).toHaveAttribute("aria-valuenow", "4");
    await expect(canvas.getByText("strong")).toBeInTheDocument();
  },
};
