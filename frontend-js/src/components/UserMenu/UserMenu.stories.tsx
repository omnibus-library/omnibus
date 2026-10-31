import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { expect, waitFor } from "storybook/test";
import {
  getLogoutMockHandler204,
  getStopImpersonationMockHandler204,
} from "../../api/generated/omnibus.msw";
import { meQuery } from "../../session";
import { storyClient } from "../../testing/AppHarness";
import {
  failing,
  hanging,
  recentProgressHandler,
  sessionHandler,
} from "../../testing/handlers";
import { aWireResumePoint, WIRE_ADA } from "../../testing/wire";
import { UserMenu } from "./UserMenu";

/** A member Ada is signed in as. */
const WIRE_BEN = {
  ...WIRE_ADA,
  id: 7,
  username: "ben",
  display_name: "Ben Reader",
  is_admin: false,
  impersonation: {
    impersonator_id: WIRE_ADA.id,
    impersonator_name: "Ada Lovelace",
    expires_at: 1_900_000_000,
  },
};

const stopped = { calls: 0 };
const signedOut = { calls: 0 };

function Where() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="where">
      {pathname}
      {search}
    </output>
  );
}

// What `RequireAuth` does in the app: nothing signed-in renders once the session is gone.
function WhileSignedIn({ children }: { children: ReactNode }) {
  return useQuery(meQuery).data ? children : null;
}

const withWhere = () => (
  <>
    <WhileSignedIn>
      <UserMenu />
    </WhileSignedIn>
    <Where />
  </>
);

const meta = {
  title: "Components/UserMenu",
  component: UserMenu,
  beforeEach({ msw }) {
    stopped.calls = 0;
    signedOut.calls = 0;
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
    const switchUser = canvas.getByRole("link", { name: "Switch user" });
    await expect(switchUser).toHaveAttribute("href", "/admin?section=people");
    await expect(switchUser).toHaveAttribute(
      "data-testid",
      "user-menu-switch-user",
    );
  },
};

export const WishlistsLeadsTheAccountRows: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );

    const wishlists = canvas.getByRole("link", { name: "Wishlists" });
    await expect(wishlists).toHaveAttribute("href", "/wishlists");
    await expect(wishlists).toHaveAttribute(
      "data-testid",
      "user-menu-wishlists",
    );
    const settings = canvas.getByRole("link", { name: "Settings" });
    await expect(
      wishlists.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    await expect(canvas.queryByText("Switch user")).not.toBeInTheDocument();
  },
};

const IMPERSONATING = { user: WIRE_BEN, path: "/library" };

export const Impersonating: Story = {
  parameters: IMPERSONATING,
  // 25 minutes left when the story starts, not when its file loads.
  beforeEach({ parameters }) {
    parameters.user = {
      ...WIRE_BEN,
      impersonation: {
        ...WIRE_BEN.impersonation,
        expires_at: Math.floor(Date.now() / 1000) + 25 * 60,
      },
    };
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", {
      name: "Open user menu, viewing as Ben Reader",
    });
    await expect(trigger).toHaveClass("um-trigger-impersonating");
    await userEvent.click(trigger);

    const strip = canvas.getByTestId("user-menu-impersonating");
    await expect(strip).toHaveTextContent("Viewing as Ben Reader");
    await expect(strip).toHaveTextContent(
      "Signed in as Ada Lovelace · ends in 25 min",
    );
    const back = canvas.getByRole("button", { name: "Return to Ada Lovelace" });
    await expect(back).toHaveAttribute("data-testid", "user-menu-return");
    await expect(
      canvas.queryByRole("link", { name: "Switch user" }),
    ).not.toBeInTheDocument();
  },
};

export const ImpersonatedAdminStillReturns: Story = {
  parameters: { user: { ...WIRE_BEN, is_admin: true } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open user menu, viewing as Ben Reader",
      }),
    );

    await expect(
      canvas.getByRole("button", { name: "Return to Ada Lovelace" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Switch user" }),
    ).not.toBeInTheDocument();
  },
};

export const ReturnToAdmin: Story = {
  parameters: IMPERSONATING,
  beforeEach({ msw }) {
    msw.use(
      getStopImpersonationMockHandler204(() => {
        stopped.calls += 1;
      }),
      sessionHandler(WIRE_ADA),
    );
  },
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open user menu, viewing as Ben Reader",
      }),
    );
    await userEvent.click(canvas.getByTestId("user-menu-return"));

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/admin?section=people",
      ),
    );
    await expect(stopped.calls).toBe(1);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toMatchObject({
      id: WIRE_ADA.id,
      impersonation: null,
    });
  },
};

export const SignOutLeavesForLogin: Story = {
  beforeEach({ msw }) {
    msw.use(
      getLogoutMockHandler204(() => {
        signedOut.calls += 1;
      }),
      sessionHandler(null),
    );
  },
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent("/login"),
    );
    await expect(signedOut.calls).toBe(1);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toBeNull();
  },
};

export const SignOutWhileImpersonating: Story = {
  parameters: IMPERSONATING,
  beforeEach({ msw }) {
    msw.use(
      getLogoutMockHandler204(() => {
        signedOut.calls += 1;
      }),
      sessionHandler(WIRE_ADA),
    );
  },
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open user menu, viewing as Ben Reader",
      }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/admin?section=people",
      ),
    );
    await expect(signedOut.calls).toBe(1);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toMatchObject({
      id: WIRE_ADA.id,
    });
    await expect(
      canvas.queryByTestId("user-menu-panel"),
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

export const ReturnWhoseSessionCannotBeReadSignsOut: Story = {
  parameters: IMPERSONATING,
  beforeEach({ msw }) {
    msw.use(
      getStopImpersonationMockHandler204(),
      failing("get", "/api/auth/me", 500),
    );
  },
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open user menu, viewing as Ben Reader",
      }),
    );
    await userEvent.click(canvas.getByTestId("user-menu-return"));

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent("/login"),
    );
    await expect(storyClient().getQueryData(meQuery.queryKey)).toBeNull();
  },
};

export const SwitchesAreExclusive: Story = {
  parameters: IMPERSONATING,
  beforeEach({ msw }) {
    msw.use(hanging("/api/auth/impersonation/stop", "post"));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open user menu, viewing as Ben Reader",
      }),
    );
    await userEvent.click(canvas.getByTestId("user-menu-return"));

    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Sign out" })).toBeDisabled(),
    );
  },
};
