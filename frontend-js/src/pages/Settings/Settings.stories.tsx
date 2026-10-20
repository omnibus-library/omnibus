import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, waitFor } from "storybook/test";
import {
  SettingsShell,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import { sameSection } from "../../settingsIndex";
import { SettingsRoutes } from "../../testing/SettingsRoutes";
import { WIRE_ADA } from "../../testing/wire";

const meta = {
  title: "Pages/Settings",
  component: SettingsRoutes,
  parameters: { ownRouter: true },
} satisfies Meta<typeof SettingsRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

const SECTIONS: [string, string][] = [
  ["settings-nav-profile", "Profile"],
  ["settings-nav-preferences", "Preferences"],
  ["settings-nav-goals", "Goals"],
  ["settings-nav-devices", "Devices"],
  ["settings-nav-security", "Sign-in & security"],
];

export const OpensOnProfile: Story = {
  play: async ({ canvas }) => {
    const sidebar = await canvas.findByRole("navigation", {
      name: "Settings sections",
    });
    await expect(sidebar).toHaveTextContent("Settings");
    for (const [testId, label] of SECTIONS) {
      await expect(canvas.getByTestId(testId)).toHaveTextContent(label);
    }
    await expect(canvas.getByTestId("settings-nav-profile")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByTestId("settings-nav-goals")).toHaveAttribute(
      "aria-current",
      "false",
    );
    await expect(
      canvas.getByRole("heading", { level: 2, name: "Profile" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("settings-layout")).not.toHaveClass(
      "has-section",
    );
    await waitFor(() =>
      expect(document.title).toBe("Omnibus | Profile · Settings"),
    );
  },
};

export const OpensTheSectionInTheLink: Story = {
  args: { path: "/settings?section=goals" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Goals" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("settings-nav-goals")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByTestId("settings-layout")).toHaveClass(
      "has-section",
    );
    await waitFor(() =>
      expect(document.title).toBe("Omnibus | Goals · Settings"),
    );
  },
};

export const OpensProfileForAnUnknownSection: Story = {
  args: { path: "/settings?section=smtp" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Profile" }),
    ).toBeInTheDocument();
  },
};

export const LinksToAdministrationForAnAdmin: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Administration" }),
    ).toHaveAttribute("href", "/admin");
  },
};

export const HidesAdministrationFromAMember: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  play: async ({ canvas }) => {
    await canvas.findByRole("link", { name: "Profile" });
    await expect(
      canvas.queryByRole("link", { name: "Administration" }),
    ).not.toBeInTheDocument();
  },
};

export const BackLinkReturnsToTheList: Story = {
  args: { path: "/settings?section=goals" },
  play: async ({ canvas, userEvent }) => {
    const back = await canvas.findByTestId("settings-back");
    await expect(back).toHaveAttribute("href", "/settings");
    await userEvent.click(back);

    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Profile" }),
    ).toBeInTheDocument();
  },
};

export const SendsAnOldSlugToItsNewSection: Story = {
  args: { path: "/settings?section=kindle" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Devices" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("settings-nav-devices")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const SendsAnOldAdminSlugToAdministration: Story = {
  args: { path: "/settings?section=logs" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Landed on /admin?section=logs"),
    ).toBeInTheDocument();
  },
};

// A form of the story's own, standing in for a section's: the shell sees only its dirtiness.
function EditableForm() {
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard("story-form", dirty);
  return (
    <label>
      <input
        type="checkbox"
        checked={dirty}
        onChange={(e) => setDirty(e.target.checked)}
      />
      Edited
    </label>
  );
}

function GuardedShell() {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        {
          path: "/settings",
          element: (
            <SettingsShell
              title="Settings"
              testId="settings-layout"
              navLabel="Settings sections"
              nav={[
                {
                  items: [
                    {
                      to: "/settings?section=profile",
                      label: "Profile",
                      testId: "settings-nav-profile",
                      active: true,
                    },
                    {
                      to: "/settings?section=goals",
                      label: "Goals",
                      testId: "settings-nav-goals",
                      active: false,
                    },
                    {
                      to: "/shelves",
                      label: "Shelves",
                      testId: "settings-nav-shelves",
                      active: false,
                    },
                  ],
                },
              ]}
              hasSection
              backTo="/settings"
              samePlace={sameSection}
            >
              <EditableForm />
            </SettingsShell>
          ),
        },
        { path: "/shelves", element: <p>Shelves page</p> },
      ],
      { initialEntries: ["/settings?section=profile"] },
    ),
  );
  return <RouterProvider router={router} />;
}

export const AsksBeforeLeavingEditedSection: Story = {
  render: () => <GuardedShell />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("settings-nav-goals"));

    const dialog = await canvas.findByTestId("unsaved-confirm");
    await expect(dialog).toHaveTextContent(
      "You've edited a setting in this section without saving it.",
    );
    await userEvent.click(canvas.getByTestId("unsaved-keep"));

    await waitFor(() =>
      expect(canvas.queryByTestId("unsaved-confirm")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByLabelText("Edited")).toBeChecked();
  },
};

export const AsksBeforeLeavingForAnotherRoute: Story = {
  render: () => <GuardedShell />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("settings-nav-shelves"));
    await userEvent.click(await canvas.findByTestId("unsaved-discard"));

    await expect(await canvas.findByText("Shelves page")).toBeInTheDocument();
  },
};

export const FollowsTheBackLinkWithoutAsking: Story = {
  render: () => <GuardedShell />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("settings-back"));

    await expect(
      canvas.queryByTestId("unsaved-confirm"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Edited")).toBeChecked();
  },
};
