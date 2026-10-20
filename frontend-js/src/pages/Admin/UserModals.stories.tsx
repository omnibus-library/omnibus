import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { adminUsersQuery, userSessionsQuery } from "../../api";
import { meQuery } from "../../session";
import { seedQueries, storyClient } from "../../testing/AppHarness";
import {
  aWireAdminUser,
  aWireAdminUsers,
  aWireDevice,
  type Revoked,
  sessionsHandlers,
  type UserWrites,
  usersHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { aWireAuthSession, WIRE_ADA } from "../../testing/wire";
import {
  DeleteUserModal,
  EditUserModal,
  NewUserModal,
  SessionsModal,
} from "./UserModals";
import { UsersCard } from "./UsersCard";

const USERS = "/api/admin/users";
const ALICE = aWireAdminUser({ locked: true });

const writes: UserWrites = {
  unlocked: [],
  created: [],
  permissions: [],
  passwords: [],
  deleted: [],
};
const revoked: Revoked = { sessions: [], devices: [] };
const calls = { closed: 0, done: 0 };
const reads = { users: 0, me: 0 };

const meta = {
  title: "Pages/Admin/UserModals",
  component: UsersCard,
  beforeEach({ msw }) {
    for (const list of Object.values(writes)) list.length = 0;
    revoked.sessions.length = 0;
    revoked.devices.length = 0;
    calls.closed = 0;
    calls.done = 0;
    reads.users = 0;
    reads.me = 0;
    msw.use(
      ...usersHandlers(aWireAdminUsers(), writes),
      ...sessionsHandlers(
        {
          sessions: [
            aWireAuthSession(),
            aWireAuthSession({ id: 5, client: "Kobo Clara", device_id: 4 }),
          ],
          devices: [aWireDevice()],
        },
        { revoked },
      ),
    );
  },
} satisfies Meta<typeof UsersCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const close = () => {
  calls.closed += 1;
};
const done = () => {
  calls.done += 1;
};

const checkbox = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("checkbox", { name });

// What `RequireAuth` does in the app: nothing signed-in renders once the session is gone.
// It reads the location as well, so it re-renders with the screens under it when a sign-out navigates.
function WhileSignedIn({ children }: { children: ReactNode }) {
  useLocation();
  return useQuery(meQuery).data ? children : null;
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const signedInUsers = () => (
  <>
    <WhileSignedIn>
      <UsersCard />
    </WhileSignedIn>
    <Where />
  </>
);

const editAlice = () => (
  <EditUserModal user={ALICE} isSelf={false} onClose={close} />
);

/** Puts the accounts list in the cache, so a story can see whether the modal marks it stale. */
const seedUsersList = () => seedQueries([[...adminUsersQuery.queryKey]]);
const usersListInvalidated = () =>
  storyClient().getQueryState(adminUsersQuery.queryKey)?.isInvalidated;

let listGate = deferred();
let gatedReads = 0;

// The sessions list answers `first` at once and every later read only once `listGate` opens.
function gatedSessionReads(first: () => Response) {
  gatedReads = 0;
  return http.get("/api/admin/users/:id/sessions", async () => {
    if (++gatedReads === 1) return first();
    await listGate.promise;
    return HttpResponse.json([aWireAuthSession()]);
  });
}

const readsOfUsersAndMe = [
  http.get("/api/admin/users", () => {
    reads.users += 1;
    return HttpResponse.json(aWireAdminUsers());
  }),
  http.get("/api/auth/me", () => {
    reads.me += 1;
    return HttpResponse.json(WIRE_ADA);
  }),
];

export const NewUserStartsWithDownloadOnly: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await expect(
      within(dialog).getByRole("heading", { level: 3, name: "New user" }),
    ).toBeInTheDocument();
    await expect(within(dialog).getByLabelText("Username")).toHaveValue("");
    await expect(within(dialog).getByLabelText("Password")).toHaveValue("");
    await expect(
      within(dialog).getByRole("meter", { name: "Password strength" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(within(dialog).getByText("Password needs")).toBeVisible();
    await expect(checkbox(dialog, "Administrator")).not.toBeChecked();
    await expect(checkbox(dialog, "Upload books")).not.toBeChecked();
    await expect(checkbox(dialog, "Edit metadata")).not.toBeChecked();
    await expect(checkbox(dialog, "Download")).toBeChecked();
  },
};

export const NewUserMeterFollowsThePassword: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(
      within(dialog).getByLabelText("Password"),
      "Abcdefghij1",
    );

    await expect(
      within(dialog).getByRole("meter", { name: "Password strength" }),
    ).toHaveAttribute("aria-valuenow", "4");
    await expect(within(dialog).getByText("strong")).toBeVisible();
  },
};

export const AdministratorForcesAndDisablesTheOtherThree: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.click(checkbox(dialog, "Administrator"));

    for (const name of ["Upload books", "Edit metadata", "Download"]) {
      await expect(checkbox(dialog, name)).toBeChecked();
      await expect(checkbox(dialog, name)).toBeDisabled();
    }
    await userEvent.click(checkbox(dialog, "Administrator"));
    for (const name of ["Upload books", "Edit metadata", "Download"]) {
      await expect(checkbox(dialog, name)).toBeEnabled();
    }
  },
};

export const NewUserRefusesBlankCredentials: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );

    const alert = await within(dialog).findByRole("alert");
    await expect(alert).toHaveTextContent("Enter a username and password.");
    await expect(alert).toHaveAttribute("data-testid", "users-modal-error");
    await expect(writes.created).toEqual([]);
  },
};

export const NewUserRefusesAMissingPassword: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(within(dialog).getByLabelText("Username"), "carol");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter a username and password.",
    );
    await expect(writes.created).toEqual([]);
  },
};

export const NewUserClearsTheRefusalOnceTypingStarts: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    await within(dialog).findByRole("alert");

    // Even a keystroke that leaves the username blank, as a space does.
    await userEvent.type(within(dialog).getByLabelText("Username"), " ");

    await expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const NewUserSendsWhatWasEntered: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(within(dialog).getByLabelText("Username"), " carol ");
    await userEvent.type(
      within(dialog).getByLabelText("Password"),
      "Abcdefghij1",
    );
    await userEvent.click(checkbox(dialog, "Edit metadata"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );

    await waitFor(() => expect(calls.done).toBe(1));
    await expect(writes.created).toEqual([
      {
        username: "carol",
        password: "Abcdefghij1",
        permissions: {
          is_admin: false,
          can_upload: false,
          can_edit: true,
          can_download: true,
        },
      },
    ]);
  },
};

export const NewUserShowsARefusal: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        USERS,
        () => new HttpResponse("username is already taken", { status: 409 }),
      ),
    );
  },
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(within(dialog).getByLabelText("Username"), "alice");
    await userEvent.type(
      within(dialog).getByLabelText("Password"),
      "Abcdefghij1",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );

    const alert = await within(dialog).findByRole("alert");
    await expect(alert).toHaveTextContent("username is already taken");
    await expect(calls.done).toBe(0);
    await expect(
      within(dialog).getByRole("button", { name: "Create user" }),
    ).toBeEnabled();
  },
};

let createGate = deferred();

export const NewUserHoldsTheButtonWhileCreating: Story = {
  beforeEach({ msw }) {
    createGate = deferred();
    msw.use(
      http.post(USERS, async () => {
        await createGate.promise;
        return HttpResponse.json(aWireAdminUser({ id: 10 }), { status: 201 });
      }),
    );
  },
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(within(dialog).getByLabelText("Username"), "carol");
    await userEvent.type(
      within(dialog).getByLabelText("Password"),
      "Abcdefghij1",
    );
    const create = within(dialog).getByRole("button", { name: "Create user" });
    await userEvent.click(create);

    await waitFor(() => expect(create).toHaveTextContent("Creating…"));
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("aria-busy", "true");
    createGate.release();
    await waitFor(() => expect(calls.done).toBe(1));
  },
};

export const NewUserHoldsTheScrimOnceCredentialsAreTyped: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(within(dialog).getByLabelText("Username"), "carol");

    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByTestId("users-new-modal"));
    await expect(calls.closed).toBe(0);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close" }),
    );

    await expect(calls.closed).toBe(1);
  },
};

export const NewUserClosesOnEscapeWhileEmpty: Story = {
  render: () => <NewUserModal onClose={close} onCreated={done} />,
  play: async ({ canvas, userEvent }) => {
    // The dialog takes focus once it has painted; Escape only reaches it there.
    await waitFor(async () =>
      expect(
        await canvas.findByRole("dialog", { name: "New user" }),
      ).toHaveFocus(),
    );

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(calls.closed).toBe(1));
  },
};

export const EditUserStartsFromTheRowsPermissions: Story = {
  render: editAlice,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    await expect(checkbox(dialog, "Administrator")).not.toBeChecked();
    await expect(checkbox(dialog, "Upload books")).toBeChecked();
    await expect(checkbox(dialog, "Edit metadata")).not.toBeChecked();
    await expect(checkbox(dialog, "Download")).toBeChecked();
    await expect(
      within(dialog).getByLabelText("Reset password"),
    ).toHaveAccessibleDescription("Leave blank to keep the current password.");
    await expect(
      within(dialog).queryByRole("meter", { name: "Password strength" }),
    ).not.toBeInTheDocument();
  },
};

export const EditUserShowsTheMeterOnceAPasswordIsTyped: Story = {
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    await userEvent.type(
      within(dialog).getByLabelText("Reset password"),
      "Abcdefghij1",
    );

    await expect(
      within(dialog).getByRole("meter", { name: "Password strength" }),
    ).toHaveAttribute("aria-valuenow", "4");
  },
};

export const EditUserSavesPermissionsWithoutAPassword: Story = {
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    await userEvent.click(checkbox(dialog, "Edit metadata"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(calls.closed).toBe(1));
    await expect(writes.permissions).toEqual([
      {
        id: 7,
        permissions: {
          is_admin: false,
          can_upload: true,
          can_edit: true,
          can_download: true,
        },
      },
    ]);
    await expect(writes.passwords).toEqual([]);
  },
};

export const EditUserSavesAPasswordTypedWithThePermissions: Story = {
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    await userEvent.type(
      within(dialog).getByLabelText("Reset password"),
      "new-password-1",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(calls.closed).toBe(1));
    await expect(writes.passwords).toEqual([
      { id: 7, password: "new-password-1" },
    ]);
    await expect(writes.permissions).toHaveLength(1);
  },
};

export const EditUserStopsAtTheFirstFailure: Story = {
  beforeEach({ msw }) {
    msw.use(failing("patch", "/api/admin/users/:id/permissions", 403));
  },
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    seedUsersList();
    await userEvent.type(
      within(dialog).getByLabelText("Reset password"),
      "new-password-1",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 403",
    );
    await expect(writes.passwords).toEqual([]);
    await expect(usersListInvalidated()).toBe(false);
    await expect(calls.closed).toBe(0);
  },
};

export const EditUserShowsAPasswordRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/admin/users/:id/password",
        () => new HttpResponse("password is too weak", { status: 422 }),
      ),
    );
  },
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    seedUsersList();
    await userEvent.type(within(dialog).getByLabelText("Reset password"), "x");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "password is too weak",
    );
    await expect(usersListInvalidated()).toBe(true);
    await expect(calls.closed).toBe(0);
  },
};

export const EditUserHoldsTheScrimOnceEdited: Story = {
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    await userEvent.click(checkbox(dialog, "Edit metadata"));

    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByTestId("users-edit-modal"));
    await expect(calls.closed).toBe(0);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close" }),
    );

    await expect(calls.closed).toBe(1);
  },
};

export const EditUserClosesOnEscapeUntilEdited: Story = {
  render: editAlice,
  play: async ({ canvas, userEvent }) => {
    await waitFor(async () =>
      expect(
        await canvas.findByRole("dialog", { name: "Edit alice" }),
      ).toHaveFocus(),
    );

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(calls.closed).toBe(1));
  },
};

export const DeleteUserAsksBeforeDeleting: Story = {
  render: () => (
    <DeleteUserModal
      user={ALICE}
      isSelf={false}
      onClose={close}
      onDeleted={done}
    />
  ),
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Delete alice" });
    await expect(
      within(dialog).getByRole("heading", { level: 3, name: "Delete alice" }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText(
        "Permanently delete alice and all of their reading data. This can't be undone.",
      ),
    ).toBeInTheDocument();
    await expect(
      within(dialog).queryByTestId("delete-self-warning"),
    ).not.toBeInTheDocument();
    await expect(writes.deleted).toEqual([]);
  },
};

export const DeleteUserRemovesTheRow: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete alice" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Delete alice" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete user" }),
    );

    await waitFor(() =>
      expect(canvas.queryByTestId("user-row-7")).not.toBeInTheDocument(),
    );
    await expect(writes.deleted).toEqual([7]);
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const DeleteUserCancelsWithoutDeleting: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete alice" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Delete alice" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(writes.deleted).toEqual([]);
    await expect(canvas.getByTestId("user-row-7")).toBeInTheDocument();
  },
};

export const DeleteUserOnYourOwnRowSignsYouOut: Story = {
  render: signedInUsers,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delete ada" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Delete ada" });
    await expect(
      within(dialog).getByTestId("delete-self-warning"),
    ).toHaveTextContent("This is your own account — you'll be signed out.");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete user" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent("/login"),
    );
    await expect(writes.deleted).toEqual([1]);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toBeNull();
  },
};

export const DeleteUserShowsARefusal: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.delete(
        "/api/admin/users/:id",
        () =>
          new HttpResponse("cannot delete the last administrator", {
            status: 409,
          }),
      ),
    );
  },
  render: () => (
    <DeleteUserModal
      user={ALICE}
      isSelf={false}
      onClose={close}
      onDeleted={done}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Delete alice" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete user" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "cannot delete the last administrator",
    );
    await expect(calls.done).toBe(0);
    await expect(
      within(dialog).getByRole("button", { name: "Delete user" }),
    ).toBeEnabled();
  },
};

let deleteGate = deferred();

export const DeleteUserHoldsTheDialogWhileDeleting: Story = {
  beforeEach({ msw }) {
    deleteGate = deferred();
    msw.use(
      http.delete("/api/admin/users/:id", async () => {
        await deleteGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => (
    <DeleteUserModal
      user={ALICE}
      isSelf={false}
      onClose={close}
      onDeleted={done}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", { name: "Delete alice" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete user" }),
    );

    const busy = await within(dialog).findByRole("button", {
      name: "Deleting…",
    });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(dialog).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await expect(calls.closed).toBe(0);
    deleteGate.release();
    await waitFor(() => expect(calls.done).toBe(1));
  },
};

export const SessionsWaitsForBothLists: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/admin/users/:id/devices"));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await waitFor(() =>
      expect(
        storyClient().getQueryData(userSessionsQuery(ALICE.id).queryKey),
      ).toBeDefined(),
    );
    await expect(
      within(dialog).getByTestId("user-sessions-loading"),
    ).toHaveTextContent("Reading sessions and devices…");
    await expect(
      within(dialog).queryByRole("heading", { level: 4 }),
    ).not.toBeInTheDocument();
    await expect(
      within(dialog).queryByText("No registered devices."),
    ).not.toBeInTheDocument();
  },
};

export const SessionsListsSessionsAndDevices: Story = {
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(
      await within(dialog).findByRole("heading", {
        level: 4,
        name: "Sessions",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByRole("heading", { level: 4, name: "Devices" }),
    ).toBeInTheDocument();
    await expect(
      within(dialog)
        .getAllByTestId("user-session-row")
        .map((row) => row.firstElementChild?.textContent),
    ).toEqual([
      "Firefox on Linux · last used Oct 10, 2025",
      "Kobo Clara · last used Oct 10, 2025",
    ]);
    await expect(
      within(dialog)
        .getAllByTestId("user-device-row")
        .map((row) => row.firstElementChild?.textContent),
    ).toEqual(["Kobo Clara · kobo · last seen Jan 1, 2024"]);
    await expect(
      within(dialog).getByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByRole("button", {
        name: "Revoke the device Kobo Clara",
      }),
    ).toBeInTheDocument();
  },
};

export const SessionsNamesAnUnnamedClient: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...sessionsHandlers({
        sessions: [aWireAuthSession({ client: undefined })],
        devices: [],
      }),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(
      await within(dialog).findByRole("button", {
        name: "Revoke the session on Unknown client",
      }),
    ).toBeInTheDocument();
  },
};

export const SessionsShowsTheEmptyLines: Story = {
  beforeEach({ msw }) {
    msw.use(...sessionsHandlers({ sessions: [], devices: [] }));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(
      await within(dialog).findByText("No live sessions."),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText("No registered devices."),
    ).toBeInTheDocument();
  },
};

export const SessionsRevokesASessionAndReadsBothListsAgain: Story = {
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: "Revoke the device Kobo Clara",
      }),
    );

    // The server ends the sessions tied to a revoked device, so both lists must be read again.
    await expect(
      await within(dialog).findByText("No registered devices."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getAllByTestId("user-session-row")).toHaveLength(1),
    );
    await expect(revoked.devices).toEqual([4]);
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    );
    await expect(
      await within(dialog).findByText("No live sessions."),
    ).toBeInTheDocument();
    await expect(revoked.sessions).toEqual([1]);
  },
};

let revokeGate = deferred();

export const SessionsHoldsTheClickedRevokeWhileRevoking: Story = {
  beforeEach({ msw }) {
    revokeGate = deferred();
    msw.use(
      http.delete("/api/admin/sessions/:id", async () => {
        await revokeGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const revoke = await within(dialog).findByRole("button", {
      name: "Revoke the session on Firefox on Linux",
    });
    await userEvent.click(revoke);

    await waitFor(() => expect(revoke).toHaveTextContent("Revoking…"));
    await expect(revoke).toBeDisabled();
    await expect(revoke).toHaveAttribute("aria-busy", "true");
    await expect(
      within(dialog).getByRole("button", {
        name: "Revoke the device Kobo Clara",
      }),
    ).not.toHaveTextContent("Revoking…");
    revokeGate.release();
    await waitFor(() => expect(revoke).toBeEnabled());
  },
};

export const SessionsShowsARevokeRefusalUntilTheNextRevoke: Story = {
  beforeEach({ msw }) {
    let attempts = 0;
    msw.use(
      http.delete("/api/admin/sessions/:id", () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse("session not found", { status: 404 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const revoke = await within(dialog).findByRole("button", {
      name: "Revoke the session on Firefox on Linux",
    });
    await userEvent.click(revoke);

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "session not found",
    );
    await userEvent.click(revoke);

    await waitFor(() =>
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(),
    );
  },
};

export const SessionsShowsALoadFailure: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/admin/users/:id/sessions", 500));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      within(dialog).queryByTestId("user-sessions-loading"),
    ).not.toBeInTheDocument();
    await expect(
      within(dialog).queryByText("No registered devices."),
    ).not.toBeInTheDocument();
  },
};

export const SessionsHoldsTheRevokeUntilBothListsAreReadAgain: Story = {
  beforeEach({ msw }) {
    listGate = deferred();
    msw.use(gatedSessionReads(() => HttpResponse.json([aWireAuthSession()])));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const revoke = await within(dialog).findByRole("button", {
      name: "Revoke the session on Firefox on Linux",
    });
    await userEvent.click(revoke);

    // The second read starts only once the revoke has been answered.
    await waitFor(() => expect(gatedReads).toBe(2));
    await expect(revoked.sessions).toEqual([1]);
    await expect(revoke).toHaveAttribute("aria-busy", "true");
    await expect(revoke).toBeDisabled();
    listGate.release();
    await waitFor(() => expect(revoke).toBeEnabled());
  },
};

export const SessionsClearsARevokeRefusalOnceTheListsAreReadAgain: Story = {
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/admin/sessions/:id", 404));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    );
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 404",
    );

    await storyClient().refetchQueries({
      queryKey: userSessionsQuery(ALICE.id).queryKey,
    });

    await waitFor(() =>
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(),
    );
  },
};

export const SessionsKeepsARevokeRefusalThatArrivesWhileTheListsAreRead: Story =
  {
    beforeEach({ msw }) {
      listGate = deferred();
      msw.use(
        gatedSessionReads(() => HttpResponse.json([aWireAuthSession()])),
        failing("delete", "/api/admin/sessions/:id", 404),
      );
    },
    render: () => <SessionsModal user={ALICE} onClose={close} />,
    play: async ({ canvas, userEvent }) => {
      const dialog = await canvas.findByRole("dialog", {
        name: "Sessions & devices — alice",
      });
      const revoke = await within(dialog).findByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      });
      const sessionsKey = userSessionsQuery(ALICE.id).queryKey;
      const reread = storyClient().refetchQueries({ queryKey: sessionsKey });
      await waitFor(() =>
        expect(storyClient().getQueryState(sessionsKey)?.fetchStatus).toBe(
          "fetching",
        ),
      );
      await userEvent.click(revoke);

      await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "failed with 404",
      );
      listGate.release();
      await reread;
      await expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "failed with 404",
      );
    },
  };

export const SessionsHidesALoadFailureWhileTheListsAreReadAgain: Story = {
  beforeEach({ msw }) {
    listGate = deferred();
    msw.use(
      gatedSessionReads(
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );

    void storyClient().refetchQueries({
      queryKey: userSessionsQuery(ALICE.id).queryKey,
    });

    await waitFor(() =>
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(),
    );
    await expect(
      within(dialog).getByTestId("user-sessions-loading"),
    ).toBeInTheDocument();
    listGate.release();
    await expect(
      await within(dialog).findByTestId("user-sessions-list"),
    ).toBeInTheDocument();
  },
};

export const SessionsCloseButtonsClose: Story = {
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const buttons = within(dialog).getAllByRole("button", { name: "Close" });
    await expect(buttons).toHaveLength(2);

    for (const button of buttons) await userEvent.click(button);

    await expect(calls.closed).toBe(2);
  },
};

export const NewUserButtonCreatesAnAccountAndReadsTheListAgain: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "New user" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "New user" });
    await userEvent.type(within(dialog).getByLabelText("Username"), "carol");
    await userEvent.type(
      within(dialog).getByLabelText("Password"),
      "Abcdefghij1",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(
      within(await canvas.findByTestId("user-row-10")).getByText("carol"),
    ).toBeInTheDocument();
  },
};

export const EditButtonSavesAndReadsTheListAgain: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit alice" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Edit alice" });
    await userEvent.click(checkbox(dialog, "Edit metadata"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        [
          ...canvas.getByTestId("user-row-7").querySelectorAll(".users-chip"),
        ].map((chip) => chip.textContent),
      ).toEqual(["Upload", "Edit", "Download"]),
    );
  },
};

export const EditButtonReadsTheListAndTheSessionWhenOnlyThePermissionsLand: Story =
  {
    beforeEach({ msw }) {
      msw.use(
        ...readsOfUsersAndMe,
        failing("post", "/api/admin/users/:id/password", 403),
      );
    },
    play: async ({ canvas, userEvent }) => {
      await userEvent.click(
        await canvas.findByRole("button", { name: "Edit ada" }),
      );
      const dialog = await canvas.findByRole("dialog", { name: "Edit ada" });
      await userEvent.type(
        within(dialog).getByLabelText("Reset password"),
        "new-password-1",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );

      await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "failed with 403",
      );
      await waitFor(() => expect(reads).toEqual({ users: 2, me: 1 }));
    },
  };

let passwordGate = deferred();
let passwordArrived = deferred();
let meGate = deferred();

export const EditButtonReadsTheSessionOnlyOnceBothStepsHaveSettled: Story = {
  beforeEach({ msw }) {
    passwordGate = deferred();
    passwordArrived = deferred();
    meGate = deferred();
    msw.use(
      http.get("/api/auth/me", async () => {
        await meGate.promise;
        return HttpResponse.json(WIRE_ADA);
      }),
      http.post("/api/admin/users/:id/password", async () => {
        passwordArrived.release();
        await passwordGate.promise;
        return new HttpResponse("password is too weak", { status: 422 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit ada" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Edit ada" });
    await userEvent.type(within(dialog).getByLabelText("Reset password"), "x");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    // Demoting yourself would unmount this modal before the password refusal showed.
    await passwordArrived.promise;
    await expect(writes.permissions).toHaveLength(1);
    await expect(
      storyClient().getQueryState(meQuery.queryKey)?.isInvalidated,
    ).toBe(false);
    passwordGate.release();

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "password is too weak",
    );
    await waitFor(() =>
      expect(storyClient().getQueryState(meQuery.queryKey)?.isInvalidated).toBe(
        true,
      ),
    );
    meGate.release();
  },
};

export const EditUserOnYourOwnRowWithAPasswordSignsYouOut: Story = {
  beforeEach({ msw }) {
    msw.use(...readsOfUsersAndMe);
  },
  render: signedInUsers,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit ada" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Edit ada" });
    await userEvent.type(
      within(dialog).getByLabelText("Reset password"),
      "new-password-1",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent("/login"),
    );
    await expect(writes.passwords).toEqual([
      { id: 1, password: "new-password-1" },
    ]);
    await expect(storyClient().getQueryData(meQuery.queryKey)).toBeNull();
    // The session is over, so nothing reads it again.
    await expect(reads.me).toBe(0);
  },
};

export const EditUserOnYourOwnRowWithoutAPasswordStaysSignedIn: Story = {
  render: signedInUsers,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit ada" }),
    );
    const dialog = await canvas.findByRole("dialog", { name: "Edit ada" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("where")).not.toHaveTextContent("/login");
    await expect(writes.permissions).toHaveLength(1);
  },
};

export const SessionsButtonOpensTheUsersSessions: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sessions for alice" }),
    );

    await expect(
      await canvas.findByRole("dialog", { name: "Sessions & devices — alice" }),
    ).toBeInTheDocument();
  },
};
