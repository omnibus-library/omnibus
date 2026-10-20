import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { adminUsersQuery } from "../../api";
import { meQuery } from "../../session";
import { seedQueries, storyClient } from "../../testing/AppHarness";
import { aWireAdminUser, aWireAdminUsers } from "../../testing/adminHandlers";
import { deferred, failing } from "../../testing/handlers";
import { WIRE_ADA } from "../../testing/wire";
import { DeleteUserModal, EditUserModal, NewUserModal } from "./UserModals";
import {
  ALICE,
  calls,
  close,
  reads,
  resetUserModals,
  writes,
} from "./UserModals.stories.shared";
import { UsersCard } from "./UsersCard";

const USERS = "/api/admin/users";

const meta = {
  title: "Pages/Admin/UserModals",
  component: UsersCard,
  beforeEach: resetUserModals,
} satisfies Meta<typeof UsersCard>;

export default meta;
type Story = StoryObj<typeof meta>;

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
