import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect } from "storybook/test";
import {
  failing,
  loginHandler,
  registrationHandler,
  sessionHandler,
} from "../../testing/handlers";
import { Login } from "./Login";

const PASSWORD = "correct horse battery";

const meta = {
  title: "Pages/Login",
  component: Login,
  parameters: { user: null, path: "/login" },
  // A stand-in library at `/` shows where a successful sign-in lands.
  render: () => (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<p>Signed in to the library</p>} />
    </Routes>
  ),
  beforeEach({ msw }) {
    msw.use(sessionHandler(null), loginHandler(PASSWORD));
  },
} satisfies Meta<typeof Login>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Log in" })).toBeDisabled();
  },
};

export const OneFieldFilled: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("Username"), "ada");

    await expect(canvas.getByRole("button", { name: "Log in" })).toBeDisabled();
  },
};

export const SignsIn: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("Username"), "ada");
    await userEvent.type(canvas.getByLabelText("Password"), PASSWORD);
    await userEvent.click(canvas.getByRole("button", { name: "Log in" }));

    await expect(
      await canvas.findByText("Signed in to the library"),
    ).toBeInTheDocument();
  },
};

export const WrongPassword: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("Username"), "ada");
    await userEvent.type(canvas.getByLabelText("Password"), "not the password");
    await userEvent.click(canvas.getByRole("button", { name: "Log in" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Wrong username or password.",
    );
  },
};

export const RateLimited: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/auth/login", 429));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("Username"), "ada");
    await userEvent.type(canvas.getByLabelText("Password"), PASSWORD);
    await userEvent.click(canvas.getByRole("button", { name: "Log in" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Too many attempts",
    );
  },
};

export const OffersRegistration: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/register");
  },
};

export const RegistrationClosed: Story = {
  beforeEach({ msw }) {
    msw.use(registrationHandler(false));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("link", { name: "Create an account" }),
    ).not.toBeInTheDocument();
  },
};
