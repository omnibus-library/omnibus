import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { type AdminUserRow, adminUsersQuery, unlockUser } from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, RowSkeletons } from "../../components/Loading/Loading";
import { formatUtcDay } from "../../format";
import { endSession, meQuery, useCurrentUser } from "../../session";
import {
  DeleteUserModal,
  EditUserModal,
  NewUserModal,
  SessionsModal,
} from "./UserModals";
import { ADMIN_CHIP, NO_PERMISSIONS, permissionChips } from "./users";

/** Which modal is open over the table; the row it acts on is the one clicked. */
type OpenModal =
  | { kind: "new" }
  | { kind: "edit" | "delete" | "sessions"; user: AdminUserRow }
  | null;

function chipClass(chip: string) {
  if (chip === ADMIN_CHIP) return "users-chip users-chip-admin";
  return chip === NO_PERMISSIONS ? "users-chip-none" : "users-chip";
}

function UserRow({
  user,
  isSelf,
  onUnlocked,
  onUnlockFailed,
  onOpen,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onUnlocked: () => void;
  onUnlockFailed: (message: string) => void;
  onOpen: (kind: "edit" | "delete" | "sessions") => void;
}) {
  const unlock = useMutation({
    mutationFn: () => unlockUser(user.id),
    onSuccess: onUnlocked,
    onError: (error) => onUnlockFailed(error.message),
  });
  return (
    <tr data-testid={`user-row-${user.id}`}>
      <td>
        <span className="users-name">{user.username}</span>
        {isSelf && <span className="users-self-tag"> (you)</span>}
      </td>
      <td>
        {permissionChips(user).map((chip) => (
          <span key={chip} className={chipClass(chip)}>
            {chip}
          </span>
        ))}
      </td>
      <td className="users-kindle">{user.kindle_email ?? "—"}</td>
      <td className="users-created">{formatUtcDay(user.created_at)}</td>
      <td>
        {user.locked ? (
          <>
            <span className="users-badge users-badge-locked">Locked</span>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`user-unlock-${user.id}`}
              aria-label={`Unlock ${user.username}`}
              disabled={unlock.isPending}
              aria-busy={unlock.isPending}
              onClick={() => unlock.mutate()}
            >
              <BusyLabel
                busy={unlock.isPending}
                label="Unlock"
                busyLabel="Unlocking…"
              />
            </Button>
          </>
        ) : (
          <span className="users-badge">Active</span>
        )}
      </td>
      <td className="users-col-actions">
        <Button
          variant="ghost"
          size="sm"
          data-testid={`user-edit-${user.id}`}
          aria-label={`Edit ${user.username}`}
          onClick={() => onOpen("edit")}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`user-sessions-${user.id}`}
          aria-label={`Sessions for ${user.username}`}
          onClick={() => onOpen("sessions")}
        >
          Sessions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="users-danger"
          data-testid={`user-delete-${user.id}`}
          aria-label={`Delete ${user.username}`}
          onClick={() => onOpen("delete")}
        >
          Delete
        </Button>
      </td>
    </tr>
  );
}

/** Every account with its permissions and lock state, and the ways to change them. */
export function UsersCard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const users = useQuery(adminUsersQuery);
  const me = useCurrentUser();
  const [actionError, setActionError] = useState<string | null>(null);
  const [modal, setModal] = useState<OpenModal>(null);

  const close = () => setModal(null);
  const reloaded = () => {
    close();
    void users.refetch();
  };
  const modalFor = (open: NonNullable<OpenModal>) => {
    switch (open.kind) {
      case "new":
        return <NewUserModal onClose={close} onCreated={reloaded} />;
      case "edit":
        return (
          <EditUserModal
            user={open.user}
            onClose={close}
            onSaved={() => {
              reloaded();
              // Changing your own permissions changes what you may see.
              if (open.user.id === me.id) {
                void queryClient.invalidateQueries({
                  queryKey: meQuery.queryKey,
                });
              }
            }}
          />
        );
      case "delete":
        return (
          <DeleteUserModal
            user={open.user}
            isSelf={open.user.id === me.id}
            onClose={close}
            // Reloading after deleting yourself would only be refused.
            onDeleted={
              open.user.id === me.id
                ? () => endSession(queryClient, navigate)
                : reloaded
            }
          />
        );
      case "sessions":
        return <SessionsModal user={open.user} onClose={close} />;
      default: {
        const _exhaustive: never = open;
        return _exhaustive;
      }
    }
  };

  return (
    <>
      <section className="card" data-testid="users-card">
        <div className="users-head">
          <div>
            <h3>Accounts</h3>
            <p className="subtitle">Create, edit, and remove accounts.</p>
          </div>
          <Button
            data-testid="users-new"
            onClick={() => setModal({ kind: "new" })}
          >
            New user
          </Button>
        </div>
        {users.isError && (
          <p
            role="alert"
            className="settings-status error"
            data-testid="users-load-error"
          >
            {users.error.message}
          </p>
        )}
        {actionError && (
          <p
            role="alert"
            className="settings-status error"
            data-testid="users-action-error"
          >
            {actionError}
          </p>
        )}
        {users.data ? (
          <div className="table-scroll">
            <table
              className="users-table"
              data-testid="users-table"
              aria-label="Accounts"
            >
              <thead>
                <tr>
                  <th>User</th>
                  <th>Permissions</th>
                  <th>Kindle</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th className="users-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isSelf={user.id === me.id}
                    onUnlocked={() => {
                      setActionError(null);
                      void users.refetch();
                    }}
                    onUnlockFailed={setActionError}
                    onOpen={(kind) => setModal({ kind, user })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !users.isError && (
            <div role="status" aria-live="polite" data-testid="users-loading">
              <span className="ld-sr">Gathering the accounts</span>
              <RowSkeletons count={3} />
            </div>
          )
        )}
      </section>
      {modal && modalFor(modal)}
    </>
  );
}
