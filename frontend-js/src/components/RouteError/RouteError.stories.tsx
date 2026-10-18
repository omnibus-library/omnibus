import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryRouter,
  type LoaderFunction,
  RouterProvider,
} from "react-router";
import { expect } from "storybook/test";
import { RouteError } from "./RouteError";

// A route whose page throws in render, caught by RouteError.
function failingRoute(fail: () => never) {
  const Boom = () => fail();
  return (
    <RouterProvider
      router={createMemoryRouter([
        { path: "/", element: <Boom />, errorElement: <RouteError /> },
      ])}
    />
  );
}

// A route whose loader throws, which is how a status reaches the error page.
function failingLoader(loader: LoaderFunction) {
  return (
    <RouterProvider
      router={createMemoryRouter([
        { path: "/", loader, element: <p />, errorElement: <RouteError /> },
      ])}
    />
  );
}

const meta = {
  title: "Components/RouteError",
  component: RouteError,
  parameters: { ownRouter: true },
} satisfies Meta<typeof RouteError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThrownError: Story = {
  render: () =>
    failingRoute(() => {
      throw new Error("The shelf collapsed.");
    }),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "The shelf collapsed.",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  },
};

export const ErrorResponse: Story = {
  render: () =>
    failingLoader(() => {
      throw new Response("", {
        status: 503,
        statusText: "Service Unavailable",
      });
    }),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Error 503" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Service Unavailable",
    );
  },
};

export const UnknownValue: Story = {
  render: () =>
    failingRoute(() => {
      throw "not an Error";
    }),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Something unexpected stopped this page.",
    );
  },
};
