import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  adminHandlers,
  aWireAdminUsers,
  type UserWrites,
  usersHandlers,
} from "../../testing/adminHandlers";
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
  beforeEach({ msw }) {
    msw.use(...adminHandlers());
  },
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

export const ShowsTheSourcesCard: Story = {
  args: { path: "/admin?section=sources" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Library folders" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByLabelText("Ebook library path")).toHaveValue(
        "/library/ebooks",
      ),
    );
  },
};

export const ShowsTheMaintenanceCardsInOrder: Story = {
  args: { path: "/admin?section=maintenance" },
  play: async ({ canvas }) => {
    const run = await canvas.findByRole("heading", {
      level: 3,
      name: "Run a job",
    });
    const recent = await canvas.findByRole("heading", {
      level: 3,
      name: "Recent tasks",
    });
    await expect(
      run.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

export const ShowsTheCleanupCard: Story = {
  args: { path: "/admin?section=cleanup" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Suggested fixes" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByTestId("cleanup-kinds"),
    ).toBeInTheDocument();
  },
};

export const ShowsThePeopleCards: Story = {
  args: { path: "/admin?section=people" },
  play: async ({ canvas }) => {
    const headings = await canvas.findAllByRole("heading", { level: 3 });
    await expect(headings.map((h) => h.textContent)).toEqual([
      "Self-registration",
      "Accounts",
    ]);
    await expect(await canvas.findByTestId("users-table")).toBeInTheDocument();
  },
};

export const ShowsTheSmtpCard: Story = {
  args: { path: "/admin?section=integrations" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Email delivery (SMTP)",
      }),
    ).toBeInTheDocument();
  },
};

export const AsksBeforeLeavingEditedSources: Story = {
  args: { path: "/admin?section=sources" },
  play: async ({ canvas, userEvent }) => {
    const ebook = canvas.getByLabelText("Ebook library path");
    await waitFor(() => expect(ebook).toHaveValue("/library/ebooks"));
    await userEvent.type(ebook, "2");
    await expect(window.onbeforeunload).not.toBeNull();
    await userEvent.click(canvas.getByTestId("admin-nav-people"));

    const dialog = await canvas.findByRole("dialog", {
      name: "Discard unsaved changes",
    });
    await expect(dialog).toHaveTextContent(
      "You've edited a setting in this section without saving it.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Keep editing" }));
    await expect(ebook).toHaveValue("/library/ebooks2");
    await expect(canvas.getByTestId("admin-nav-sources")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const AsksBeforeLeavingAnEditedSmtpForm: Story = {
  args: { path: "/admin?section=integrations" },
  play: async ({ canvas, userEvent }) => {
    const host = canvas.getByLabelText("SMTP host");
    await waitFor(() => expect(host).toHaveValue("smtp.example.com"));
    await userEvent.type(host, "x");
    await userEvent.click(canvas.getByTestId("admin-nav-people"));

    await expect(
      await canvas.findByRole("dialog", { name: "Discard unsaved changes" }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Keep editing" }));
    await expect(host).toHaveValue("smtp.example.comx");
  },
};

export const AsksBeforeLeavingAnEditedMetadataOrder: Story = {
  args: { path: "/admin?section=metadata" },
  play: async ({ canvas, userEvent }) => {
    const ebook = await canvas.findByRole("list", { name: "Ebook library" });
    await userEvent.click(
      within(ebook).getByRole("button", { name: "Move Embedded tags up" }),
    );
    await userEvent.click(canvas.getByTestId("admin-nav-people"));

    await expect(
      await canvas.findByRole("dialog", { name: "Discard unsaved changes" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 2, name: "Metadata" }),
    ).toBeInTheDocument();
  },
};

export const LeavesFreelyOnceTheEditIsUndone: Story = {
  args: { path: "/admin?section=sources" },
  play: async ({ canvas, userEvent }) => {
    const ebook = canvas.getByLabelText("Ebook library path");
    await waitFor(() => expect(ebook).toHaveValue("/library/ebooks"));
    await userEvent.type(ebook, "2");
    await userEvent.type(ebook, "{Backspace}");
    await userEvent.click(canvas.getByTestId("admin-nav-people"));

    await expect(
      await canvas.findByRole("heading", { level: 2, name: "People" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(window.onbeforeunload).toBeNull();
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
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Administration" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { level: 2 }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("settings-back")).toBeNull();
  },
};

export const RefusesAReaderOnASection: Story = {
  args: { path: "/admin?section=people" },
  parameters: { user: READER },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("admin-forbidden")).toBeVisible();
    await expect(canvas.queryByRole("navigation")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Administration" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { level: 2 }),
    ).not.toBeInTheDocument();
  },
};

export const RefusesAnAdminWhoDemotesThemself: Story = {
  args: { path: "/admin?section=people" },
  beforeEach({ msw }) {
    const permissions: UserWrites["permissions"] = [];
    msw.use(
      ...usersHandlers(aWireAdminUsers(), { permissions }),
      // The session reads as a reader once the permission change has landed.
      http.get("/api/auth/me", () =>
        HttpResponse.json(permissions.length > 0 ? READER : WIRE_ADA),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit ada" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Edit ada" });
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Administrator" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await expect(await canvas.findByTestId("admin-forbidden")).toBeVisible();
    await expect(canvas.queryByTestId("admin-nav-people")).toBeNull();
  },
};
