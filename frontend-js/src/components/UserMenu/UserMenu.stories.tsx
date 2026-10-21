import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import {
  failing,
  hanging,
  recentProgressHandler,
} from "../../testing/handlers";
import { aWireResumePoint, WIRE_ADA } from "../../testing/wire";
import { UserMenu } from "./UserMenu";

const meta = {
  title: "Components/UserMenu",
  component: UserMenu,
  beforeEach({ msw }) {
    msw.use(recentProgressHandler([aWireResumePoint()]));
  },
} satisfies Meta<typeof UserMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Open user menu" });

    await expect(trigger).toHaveTextContent("AL");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    const menu = canvas.getByRole("dialog", { name: "User menu" });
    await expect(menu).toHaveTextContent("Ada Lovelace");
    await expect(menu).toHaveTextContent("ada@local · Owner");
    await expect(canvas.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/settings?section=profile",
    );
  },
};

export const NowReading: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(
      await canvas.findByRole("link", {
        name: "Continue reading Aurora Station, Vol. 1",
      }),
    ).toHaveAttribute("href", "/read/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
  },
};

export const NothingInProgress: Story = {
  beforeEach({ msw }) {
    msw.use(recentProgressHandler([]));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(
      await canvas.findByText("Nothing in progress"),
    ).toBeInTheDocument();
  },
};

export const ProgressFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/progress/recent", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Unable to load reading progress.",
    );
  },
};

export const ProgressLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/progress/recent"));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Finding your place",
    );
  },
};

export const AdminRows: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(
      canvas.getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("href", "/settings");
    await expect(
      canvas.getByRole("link", { name: "Administration" }),
    ).toHaveAttribute("href", "/admin");
  },
};

export const Member: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await expect(
      canvas.getByRole("dialog", { name: "User menu" }),
    ).toHaveTextContent("ada@local · Member");
    await expect(
      canvas.queryByRole("link", { name: "Administration" }),
    ).not.toBeInTheDocument();
  },
};

export const EscapeCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open user menu" });
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");

    await expect(
      canvas.queryByRole("dialog", { name: "User menu" }),
    ).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};

export const OutsideClickCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await userEvent.click(canvas.getByTestId("user-menu-scrim"));

    await expect(
      canvas.queryByRole("dialog", { name: "User menu" }),
    ).not.toBeInTheDocument();
  },
};

export const SignOutFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/auth/logout", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Sign out failed: failed with 500",
    );
  },
};
