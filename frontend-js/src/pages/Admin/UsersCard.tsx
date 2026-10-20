import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type AdminUserRow, adminUsersQuery, unlockUser } from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, RowSkeletons } from "../../components/Loading/Loading";
import { formatUtcDay } from "../../format";
import { useCurrentUser } from "../../session";
import { ADMIN_CHIP, NO_PERMISSIONS, permissionChips } from "./users";

function chipClass(chip: string) {
  if (chip === ADMIN_CHIP) return "users-chip users-chip-admin";
  return chip === NO_PERMISSIONS ? "users-chip-none" : "users-chip";
}

function UserRow({
  user,
  isSelf,
  onUnlocked,
  onUnlockFailed,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onUnlocked: () => void;
  onUnlockFailed: (message: string) => void;
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
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`user-sessions-${user.id}`}
          aria-label={`Sessions for ${user.username}`}
        >
          Sessions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="users-danger"
          data-testid={`user-delete-${user.id}`}
          aria-label={`Delete ${user.username}`}
        >
          Delete
        </Button>
      </td>
    </tr>
  );
}

/** Every account with its permissions and lock state, and a way to unlock one. */
export function UsersCard() {
  const users = useQuery(adminUsersQuery);
  const me = useCurrentUser();
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <section className="card" data-testid="users-card">
      <div className="users-head">
        <div>
          <h3>Accounts</h3>
          <p className="subtitle">Create, edit, and remove accounts.</p>
        </div>
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
  );
}
