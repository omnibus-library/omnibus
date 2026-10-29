import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { registrationStatusQuery } from "../../api";
import { meQuery } from "../../session";
import {
  expectInvalidated,
  seedQueries,
  storyClient,
} from "../../testing/AppHarness";
import {
  aWireAdminUser,
  aWireAdminUsers,
  registrationHandlers,
  usersHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { WIRE_ADA } from "../../testing/wire";
import { RegistrationCard } from "./RegistrationCard";
import { UsersCard } from "./UsersCard";

const REGISTRATION = "/api/auth/registration";
const REGISTRATION_WRITE = "/api/settings/registration";
const USERS = "/api/admin/users";

const OPEN = "Anyone who can reach this server can create an account.";
const CLOSED = "Only an administrator can create accounts.";

const saved: boolean[] = [];
const unlocked: number[] = [];
const impersonated: number[] = [];

const meta = {
  title: "Pages/Admin/People",
  component: UsersCard,
  beforeEach({ msw }) {
    saved.length = 0;
    unlocked.length = 0;
    impersonated.length = 0;
    msw.use(
      ...registrationHandlers({ saved }),
      ...usersHandlers(aWireAdminUsers(), { unlocked, impersonated }),
    );
  },
} satisfies Meta<typeof UsersCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const actionNames = (row: HTMLElement) =>
  within(within(row).getAllByRole("cell").at(-1) as HTMLElement)
    .getAllByRole("button")
    .map((b) => b.textContent);

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

export const AccountsLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(USERS));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Accounts" }),
    ).toBeInTheDocument();
    const loading = canvas.getByTestId("users-loading");
    await expect(loading).toHaveAttribute("role", "status");
    await expect(loading).toHaveTextContent("Gathering the accounts");
    await expect(loading.querySelectorAll(".ld-rows-row")).toHaveLength(3);
    await expect(canvas.queryByTestId("users-table")).not.toBeInTheDocument();
  },
};

export const AccountsLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", USERS, 500));
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByTestId("users-load-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveTextContent("failed with 500");
    await expect(alert).toHaveClass("settings-status", "error");
    await expect(canvas.queryByTestId("users-table")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("users-loading")).not.toBeInTheDocument();
  },
};

export const ListsEachAccount: Story = {
  play: async ({ canvas }) => {
    const table = await canvas.findByRole("table", { name: "Accounts" });
    await expect(table).toHaveClass("users-table");
    await expect(table.parentElement).toHaveClass("table-scroll");
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "User",
      "Permissions",
      "Kindle",
      "Created",
      "Status",
      "Actions",
    ]);
    await expect(cellsOf(canvas.getByTestId("user-row-1"))).toEqual([
      "ada (you)",
      "Admin",
      "—",
      "Nov 14, 2023",
      "Active",
      "EditSessionsImpersonateDelete",
    ]);
    await expect(cellsOf(canvas.getByTestId("user-row-7"))).toEqual([
      "alice",
      "UploadDownload",
      "alice@kindle.example",
      "Nov 14, 2023",
      "LockedUnlock",
      "EditSessionsImpersonateDelete",
    ]);
    await expect(cellsOf(canvas.getByTestId("user-row-9"))).toEqual([
      "bob",
      "—",
      "—",
      "Jan 1, 2024",
      "Active",
      "EditSessionsImpersonateDelete",
    ]);
  },
};

export const NamesTheUserInEveryRowAction: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("users-table");
    for (const name of [
      "Unlock alice",
      "Edit alice",
      "Sessions for alice",
      "Impersonate alice",
      "Delete alice",
    ]) {
      await expect(canvas.getByRole("button", { name })).toBeInTheDocument();
    }
    await expect(
      canvas.queryByRole("button", { name: "Unlock ada" }),
    ).not.toBeInTheDocument();
  },
};

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

// What `RequireAuth` does in the app: nothing signed-in renders once the session is gone.
function WhileSignedIn({ children }: { children: ReactNode }) {
  return useQuery(meQuery).data ? children : null;
}

const withWhere = () => (
  <>
    <UsersCard />
    <Where />
  </>
);

const CLEO = aWireAdminUser({ id: 12, username: "cleo", is_admin: true });

/** The session `/api/auth/me` reports once an impersonation has started. */
const signedInAsAlice = () =>
  http.get("/api/auth/me", () =>
    HttpResponse.json(
      impersonated.length
        ? {
            ...WIRE_ADA,
            id: 7,
            username: "alice",
            display_name: null,
            is_admin: false,
            impersonation: {
              impersonator_id: 1,
              impersonator_name: "Ada Lovelace",
              expires_at: 1_900_000_000,
            },
          }
        : WIRE_ADA,
    ),
  );

export const ImpersonateOnEveryOtherRow: Story = {
  beforeEach({ msw }) {
    msw.use(...usersHandlers([...aWireAdminUsers(), CLEO], { impersonated }));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("users-table");
    for (const [id, name] of [
      [7, "alice"],
      [9, "bob"],
      [12, "cleo"],
    ] as const) {
      const button = canvas.getByRole("button", {
        name: `Impersonate ${name}`,
      });
      await expect(button).toHaveAttribute(
        "data-testid",
        `user-impersonate-${id}`,
      );
      await expect(actionNames(canvas.getByTestId(`user-row-${id}`))).toEqual([
        "Edit",
        "Sessions",
        "Impersonate",
        "Delete",
      ]);
    }
    const own = canvas.getByTestId("user-row-1");
    await expect(
      canvas.queryByRole("button", { name: "Impersonate ada" }),
    ).not.toBeInTheDocument();
    await expect(
      own.querySelector(".users-impersonate-placeholder"),
    ).toHaveAttribute("aria-hidden", "true");
    await expect(actionNames(own)).toEqual(["Edit", "Sessions", "Delete"]);
  },
};

export const ImpersonateLandsOnTheLibrary: Story = {
  parameters: { path: "/admin?section=people" },
  beforeEach({ msw }) {
    msw.use(signedInAsAlice());
  },
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Impersonate alice" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(/^\/$/),
    );
    await expect(impersonated).toEqual([7]);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toMatchObject({
      id: 7,
      username: "alice",
    });
  },
};

export const ImpersonateRefused: Story = {
  parameters: { path: "/admin?section=people" },
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/admin/users/:id/impersonate", 409));
  },
  render: withWhere,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Impersonate alice" }),
    );

    await expect(
      await canvas.findByTestId("users-action-error"),
    ).toHaveTextContent("failed with 409");
    await expect(canvas.getByTestId("where")).toHaveTextContent("/admin");
  },
};

export const ImpersonateWhoseSessionCannotBeReadSignsOut: Story = {
  parameters: { path: "/admin?section=people" },
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/auth/me", 500));
  },
  render: () => (
    <>
      <WhileSignedIn>
        <UsersCard />
      </WhileSignedIn>
      <Where />
    </>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Impersonate alice" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent("/login"),
    );
    await expect(impersonated).toEqual([7]);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toBeNull();
  },
};

export const ImpersonateHoldsEveryButtonWhileSwitching: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/admin/users/:id/impersonate", "post"));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Impersonate alice" }),
    );

    const bob = canvas.getByRole("button", { name: "Impersonate bob" });
    await waitFor(() => expect(bob).toBeDisabled());
    await expect(
      canvas.getByRole("button", { name: "Impersonate alice" }),
    ).toHaveTextContent("Signing in…");
    await expect(bob).toHaveTextContent("Impersonate");
  },
};

export const NoImpersonateWhileImpersonating: Story = {
  parameters: {
    user: {
      ...WIRE_ADA,
      impersonation: {
        impersonator_id: 2,
        impersonator_name: "Grace Hopper",
        expires_at: 1_900_000_000,
      },
    },
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("users-table");
    await expect(
      canvas.queryByRole("button", { name: /Impersonate/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas
        .getByTestId("users-table")
        .querySelector(".users-impersonate-placeholder"),
    ).toBeNull();
  },
};

export const UnlocksALockedAccount: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Unlock alice" }),
    );

    await waitFor(() =>
      expect(
        within(canvas.getByTestId("user-row-7")).getByText("Active"),
      ).toBeInTheDocument(),
    );
    await expect(unlocked).toEqual([7]);
    await expect(
      canvas.queryByRole("button", { name: "Unlock alice" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("users-action-error"),
    ).not.toBeInTheDocument();
  },
};

let unlockGate = deferred();

export const HoldsTheButtonWhileUnlocking: Story = {
  beforeEach({ msw }) {
    unlockGate = deferred();
    msw.use(
      http.post("/api/admin/users/:id/unlock", async () => {
        await unlockGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Unlock alice" }),
    );

    const busy = await canvas.findByRole("button", { name: "Unlock alice" });
    await waitFor(() => expect(busy).toHaveTextContent("Unlocking…"));
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    unlockGate.release();
    await waitFor(() => expect(busy).toBeEnabled());
    await expect(busy).toHaveTextContent("Unlock");
    await expect(busy).not.toHaveTextContent("Unlocking…");
  },
};

export const ShowsAnUnlockRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/admin/users/:id/unlock", 404));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Unlock alice" }),
    );

    const alert = await canvas.findByTestId("users-action-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveTextContent("failed with 404");
    await expect(
      within(canvas.getByTestId("user-row-7")).getByText("Locked"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Unlock alice" }),
    ).toBeEnabled();
  },
};

export const RegistrationLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(REGISTRATION));
  },
  render: () => <RegistrationCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Self-registration",
      }),
    ).toBeInTheDocument();
    const toggle = canvas.getByRole("switch", {
      name: "Allow new users to register",
    });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveClass("ld-unknown");
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleDescription("Checking…");
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};

export const RegistrationLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", REGISTRATION, 500));
  },
  render: () => <RegistrationCard />,
  play: async ({ canvas }) => {
    const alert = await canvas.findByTestId("registration-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveTextContent("failed with 500");
    await expect(
      canvas.getByRole("switch", { name: "Allow new users to register" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  },
};

export const RetryReadsRegistrationAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(REGISTRATION, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json({ enabled: false }),
      ),
    );
  },
  render: () => <RegistrationCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Retry" }));

    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(CLOSED);
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  },
};

export const ShowsOpenRegistration: Story = {
  render: () => <RegistrationCard />,
  play: async ({ canvas }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    await expect(toggle).toBeChecked();
    await expect(toggle).not.toHaveClass("ld-unknown");
    await expect(toggle).toHaveAccessibleDescription(OPEN);
    await expect(toggle.closest(".setting-row")).not.toBeNull();
  },
};

export const ClosesRegistration: Story = {
  render: () => <RegistrationCard />,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAccessibleDescription(CLOSED));
    await expect(saved).toEqual([false]);
    await expect(toggle).not.toBeChecked();
    await waitFor(() => expect(toggle).toBeEnabled());
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

let writeGate = deferred();

export const SubtitleFollowsOnlyTheConfirmedValue: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(REGISTRATION_WRITE, async () => {
        await writeGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => <RegistrationCard />,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAccessibleDescription(OPEN);
    writeGate.release();
    await waitFor(() => expect(toggle).toHaveAccessibleDescription(CLOSED));
    await expect(toggle).toBeEnabled();
  },
};

export const PutsTheSwitchBackOnARefusal: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", REGISTRATION_WRITE, 403));
  },
  render: () => <RegistrationCard />,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);

    const alert = await canvas.findByTestId("registration-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveTextContent("failed with 403");
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(OPEN);
    await expect(toggle).toBeEnabled();
  },
};

export const InvalidatesTheSignInPagesRead: Story = {
  render: () => <RegistrationCard />,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    seedQueries([["registration"]]);
    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAccessibleDescription(CLOSED));
    await expectInvalidated([["registration"]]);
  },
};

let readGate = deferred();

export const KeepsTheSavedValueOverAReadStillInFlight: Story = {
  beforeEach({ msw }) {
    readGate = deferred();
    let reads = 0;
    msw.use(
      http.get(REGISTRATION, async () => {
        const answer = HttpResponse.json({ enabled: true });
        if (++reads > 1) await readGate.promise;
        return answer;
      }),
    );
  },
  render: () => <RegistrationCard />,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Allow new users to register",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    void storyClient().refetchQueries({
      queryKey: registrationStatusQuery.queryKey,
    });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAccessibleDescription(CLOSED));

    readGate.release();
    await waitFor(() =>
      expect(
        storyClient().getQueryState(registrationStatusQuery.queryKey)
          ?.fetchStatus,
      ).toBe("idle"),
    );
    await expect(toggle).toHaveAccessibleDescription(CLOSED);
  },
};
