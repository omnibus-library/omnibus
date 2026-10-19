import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, waitFor } from "storybook/test";
import { WIRE_ADA } from "../../testing/wire";
import { Admin } from "./Admin";

const READER = { ...WIRE_ADA, is_admin: false };

// The shell's leave guard needs a data router, which the stories' own harness doesn't provide.
function AdminRoutes({ path }: { path: string }) {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        { path: "/admin", element: <Admin /> },
        { path: "/settings", element: <p>Your settings page</p> },
      ],
      { initialEntries: [path] },
    ),
  );
  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/Admin",
  component: AdminRoutes,
  args: { path: "/admin" },
  parameters: { ownRouter: true },
} satisfies Meta<typeof AdminRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sidebar: Story = {
  play: async ({ canvas }) => {
    const nav = await canvas.findByRole("navigation", {
      name: "Administration sections",
    });
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Administration" }),
    ).toBeInTheDocument();
    const slugs = [
      "sources",
      "maintenance",
      "metadata",
      "cleanup",
      "people",
      "integrations",
      "health",
      "logs",
    ];
    const items = [...slugs, "settings"].map((slug) =>
      canvas.getByTestId(`admin-nav-${slug}`),
    );
    await expect(items.map((item) => item.textContent)).toEqual([
      "Sources",
      "Maintenance",
      "Metadata",
      "Cleanup",
      "People",
      "Integrations",
      "Health",
      "Logs",
      "Your settings",
    ]);
    await expect(
      [...nav.querySelectorAll(".settings-nav-group-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["Library", "Server"]);
    await expect(canvas.getByTestId("admin-nav-settings")).toHaveAttribute(
      "href",
      "/settings",
    );
    await expect(canvas.getByTestId("admin-nav-people")).toHaveAttribute(
      "href",
      "/admin?section=people",
    );
  },
};

export const OpensSources: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Sources" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("admin-nav-sources")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByTestId("admin-layout")).not.toHaveClass(
      "has-section",
    );
    await waitFor(() =>
      expect(document.title).toBe("Omnibus | Sources · Administration"),
    );
  },
};

export const OpensTheSectionInTheUrl: Story = {
  args: { path: "/admin?section=people" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "People" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("admin-nav-people")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByTestId("admin-nav-sources")).toHaveAttribute(
      "aria-current",
      "false",
    );
    await expect(canvas.getByTestId("admin-layout")).toHaveClass("has-section");
    await expect(canvas.getByTestId("settings-back")).toHaveAttribute(
      "href",
      "/admin",
    );
    await waitFor(() =>
      expect(document.title).toBe("Omnibus | People · Administration"),
    );
  },
};

export const OpensSourcesForAnUnknownSection: Story = {
  args: { path: "/admin?section=bogus" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Sources" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("admin-nav-sources")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const SwitchesSection: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("admin-nav-logs"));

    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Logs" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("admin-nav-logs")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const LinksToYourSettings: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("admin-nav-settings"));

    await expect(
      await canvas.findByText("Your settings page"),
    ).toBeInTheDocument();
  },
};

export const RefusesAReader: Story = {
  parameters: { user: READER },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("admin-forbidden"),
    ).toHaveTextContent(
      "Administration is only open to server administrators.",
    );
    await expect(
      canvas.getByRole("link", { name: "Go to your settings" }),
    ).toHaveAttribute("href", "/settings");
    await expect(canvas.getByTestId("admin-layout")).toHaveClass("has-section");
    await expect(canvas.queryByRole("navigation")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("admin-nav-people")).toBeNull();
    await expect(canvas.queryByRole("heading")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("settings-back")).toBeNull();
  },
};

export const RefusesAReaderOnASection: Story = {
  args: { path: "/admin?section=people" },
  parameters: { user: READER },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("admin-forbidden")).toBeVisible();
    await expect(canvas.queryByRole("navigation")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("heading")).not.toBeInTheDocument();
  },
};
