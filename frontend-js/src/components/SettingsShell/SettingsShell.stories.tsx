import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams,
} from "react-router";
import { expect, waitFor } from "storybook/test";
import {
  NavGroup,
  NavItem,
  SectionHeader,
  SettingsShell,
  useUnsavedForm,
} from "./SettingsShell";

function EditableCard() {
  const [edited, setEdited] = useState(false);
  useUnsavedForm("demo", edited);
  return (
    <label>
      <input
        type="checkbox"
        checked={edited}
        onChange={(e) => setEdited(e.target.checked)}
      />
      Edited
    </label>
  );
}

const sectionOf = (search: string) =>
  new URLSearchParams(search).get("section") ?? "one";

function Demo({ withNav }: { withNav: boolean }) {
  const [params] = useSearchParams();
  const open = sectionOf(`?${params}`);
  return (
    <SettingsShell
      title="Demo"
      testId="demo-layout"
      navLabel="Demo sections"
      backTo={withNav ? "/demo" : null}
      hasSection={params.has("section")}
      openSection={sectionOf}
      nav={
        withNav ? (
          <>
            <NavGroup label="Group">
              <NavItem
                to="/demo?section=one"
                label="One"
                testId="demo-nav-one"
                active={open === "one"}
              />
              <NavItem
                to="/demo?section=two"
                label="Two"
                testId="demo-nav-two"
                active={open === "two"}
              />
            </NavGroup>
            <NavGroup divided>
              <NavItem
                to="/elsewhere"
                label="Elsewhere link"
                testId="demo-nav-elsewhere"
                active={false}
              />
            </NavGroup>
          </>
        ) : null
      }
    >
      <SectionHeader title={open === "two" ? "Two" : "One"} />
      {open === "one" && <EditableCard />}
    </SettingsShell>
  );
}

// useBlocker needs a data router, which the stories' own harness doesn't provide.
function Shell({ path, withNav }: { path: string; withNav: boolean }) {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        { path: "/demo", element: <Demo withNav={withNav} /> },
        { path: "/elsewhere", element: <p>Elsewhere</p> },
      ],
      { initialEntries: [path] },
    ),
  );
  return <RouterProvider router={router} />;
}

const meta = {
  title: "Components/SettingsShell",
  component: Shell,
  args: { path: "/demo?section=one", withNav: true },
  parameters: { ownRouter: true },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenSection: Story = {
  play: async ({ canvas, canvasElement }) => {
    const layout = await canvas.findByTestId("demo-layout");
    await expect(layout).toHaveClass("settings-layout", "has-section");
    const nav = canvas.getByRole("navigation", { name: "Demo sections" });
    await expect(nav).toHaveClass("settings-sidebar");
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Demo" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Group")).toHaveClass(
      "settings-nav-group-label",
    );
    await expect(canvas.getByTestId("demo-nav-one")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByTestId("demo-nav-one")).toHaveClass(
      "settings-nav-item",
      "active",
    );
    await expect(canvas.getByTestId("demo-nav-two")).toHaveAttribute(
      "aria-current",
      "false",
    );
    await expect(canvas.getByTestId("demo-nav-two")).not.toHaveClass("active");
    await expect(
      canvasElement.querySelector(".settings-nav-group.divided"),
    ).not.toBeNull();
    await expect(
      canvas.getByRole("heading", { level: 2, name: "One" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("settings-back")).toHaveTextContent(
      "‹ Demo",
    );
    await expect(canvas.getByTestId("settings-back")).toHaveAttribute(
      "href",
      "/demo",
    );
  },
};

export const SectionList: Story = {
  args: { path: "/demo" },
  play: async ({ canvas }) => {
    const layout = await canvas.findByTestId("demo-layout");
    await expect(layout).toHaveClass("settings-layout");
    await expect(layout).not.toHaveClass("has-section");
  },
};

export const WithoutNav: Story = {
  args: { withNav: false },
  play: async ({ canvas }) => {
    await canvas.findByTestId("demo-layout");
    await expect(canvas.queryByRole("navigation")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("settings-back")).not.toBeInTheDocument();
  },
};

export const AsksBeforeLeavingForAnotherSection: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await expect(window.onbeforeunload).not.toBeNull();
    await userEvent.click(canvas.getByTestId("demo-nav-two"));

    const dialog = await canvas.findByRole("dialog", {
      name: "Discard unsaved changes",
    });
    await expect(dialog).toHaveTextContent("Discard unsaved changes?");
    await expect(dialog).toHaveTextContent(
      "You've edited a setting in this section without saving it.",
    );
    await expect(
      canvas.queryByRole("heading", { level: 2, name: "Two" }),
    ).not.toBeInTheDocument();
  },
};

export const AsksBeforeLeavingForAnotherPage: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("demo-nav-elsewhere"));

    await expect(await canvas.findByRole("dialog")).toBeInTheDocument();
    await expect(canvas.queryByText("Elsewhere")).not.toBeInTheDocument();
  },
};

export const KeepEditing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("demo-nav-two"));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Keep editing" }),
    );

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByLabelText("Edited")).toBeChecked();
    await expect(canvas.getByTestId("demo-nav-one")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const Discards: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("demo-nav-two"));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Discard" }),
    );

    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Two" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("demo-nav-two")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() => expect(window.onbeforeunload).toBeNull());
  },
};

export const OpenSectionsOwnLinkDoesNotAsk: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("demo-nav-one"));

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Edited")).toBeChecked();
  },
};

export const BackLinkToTheOpenSectionDoesNotAsk: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByLabelText("Edited"));
    await userEvent.click(canvas.getByTestId("settings-back"));

    // `/demo` opens section one, the one already open.
    await waitFor(() =>
      expect(canvas.getByTestId("demo-layout")).not.toHaveClass("has-section"),
    );
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const SwitchesWithoutAskingWhenClean: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("demo-nav-two"));

    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Two" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(window.onbeforeunload).toBeNull();
  },
};
