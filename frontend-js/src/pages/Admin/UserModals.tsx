import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  type AdminUserRow,
  createUser,
  deleteUser,
  revokeUserDevice,
  revokeUserSession,
  setUserPassword,
  setUserPermissions,
  type UserPermissions,
  userDevicesQuery,
  userSessionsQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import {
  ConfirmBody,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { XGlyph } from "../../components/Glyphs/Glyphs";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { StrengthMeter } from "../../components/StrengthMeter/StrengthMeter";
import { formatUtcDay } from "../../format";
import { scorePassword } from "../../password";
import { editIsDirty, permissionsOf } from "./users";

const NEW_USER_PERMISSIONS: UserPermissions = {
  is_admin: false,
  can_upload: false,
  can_edit: false,
  can_download: true,
};

const GRANTS = [
  { flag: "can_upload", label: "Upload books" },
  { flag: "can_edit", label: "Edit metadata" },
  { flag: "can_download", label: "Download" },
] as const;

function PermissionCheckbox({
  label,
  testId,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  testId: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label className="users-perm-row">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

// An administrator can do everything, so ticking Administrator grants the other three and locks them.
function PermissionToggles({
  perms,
  onChange,
}: {
  perms: UserPermissions;
  onChange: (perms: UserPermissions) => void;
}) {
  return (
    <fieldset className="users-perms">
      <legend>Permissions</legend>
      <PermissionCheckbox
        label="Administrator"
        testId="perm-is_admin"
        checked={perms.is_admin}
        disabled={false}
        onToggle={(checked) =>
          onChange(
            checked
              ? {
                  is_admin: true,
                  can_upload: true,
                  can_edit: true,
                  can_download: true,
                }
              : { ...perms, is_admin: false },
          )
        }
      />
      {GRANTS.map(({ flag, label }) => (
        <PermissionCheckbox
          key={flag}
          label={label}
          testId={`perm-${flag}`}
          checked={perms[flag]}
          disabled={perms.is_admin}
          onToggle={(checked) => onChange({ ...perms, [flag]: checked })}
        />
      ))}
    </fieldset>
  );
}

function ModalError({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p
      role="alert"
      className="settings-status error"
      data-testid="users-modal-error"
    >
      {error}
    </p>
  );
}

// While `busy` (a save out, or edits a stray click would discard) the scrim and Escape are held; the cross always works.
function ModalShell({
  title,
  testId,
  busy,
  onClose,
  children,
}: {
  title: string;
  testId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ConfirmModal
      testId={testId}
      ariaLabel={title}
      backdropClass="users-modal-overlay"
      dialogClass="users-modal-card"
      busy={busy}
      focusOnOpen
      onDismiss={onClose}
    >
      <div className="users-modal-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="users-modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          <XGlyph />
        </button>
      </div>
      <div className="users-modal-body">{children}</div>
    </ConfirmModal>
  );
}

/** Makes an account: name, password with its strength, and permissions. */
export function NewUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState(NEW_USER_PERMISSIONS);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: createUser,
    onSuccess: onCreated,
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const name = username.trim();
    if (name === "" || password === "") {
      setError("Enter a username and password.");
      return;
    }
    setError(null);
    create.mutate({ username: name, password, permissions: perms });
  };

  return (
    <ModalShell
      title="New user"
      testId="users-new-modal"
      busy={create.isPending || username !== "" || password !== ""}
      onClose={onClose}
    >
      <form className="settings-form" onSubmit={submit}>
        <div className="settings-field">
          <label htmlFor="new-user-username">Username</label>
          <input
            type="text"
            id="new-user-username"
            name="username"
            data-testid="new-user-username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="new-user-password">Password</label>
          <input
            type="password"
            id="new-user-password"
            name="new_password"
            data-testid="new-user-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
        </div>
        <StrengthMeter strength={scorePassword(password)} />
        <PermissionToggles perms={perms} onChange={setPerms} />
        <ModalError error={error} />
        <div className="settings-actions">
          <Button
            type="submit"
            data-testid="new-user-submit"
            disabled={create.isPending}
            aria-busy={create.isPending}
          >
            <BusyLabel
              busy={create.isPending}
              label="Create user"
              busyLabel="Creating…"
            />
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Changes an account's permissions, and resets its password when one is typed.
 * `onChanged` runs once the permissions land, even if the password step then
 * fails; `onSaved` runs after everything asked for is saved.
 */
export function EditUserModal({
  user,
  onClose,
  onChanged,
  onSaved,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onChanged: () => void;
  onSaved: (passwordReset: boolean) => void;
}) {
  const [perms, setPerms] = useState(() => permissionsOf(user));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    // The first refusal stops the save, so a rejected permission change never resets the password.
    mutationFn: async () => {
      await setUserPermissions(user.id, perms);
      onChanged();
      const reset = password.trim();
      if (reset === "") return false;
      await setUserPassword(user.id, reset);
      return true;
    },
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    setError(null);
    save.mutate();
  };

  return (
    <ModalShell
      title={`Edit ${user.username}`}
      testId="users-edit-modal"
      busy={save.isPending || editIsDirty(user, perms, password)}
      onClose={onClose}
    >
      <form className="settings-form" onSubmit={submit}>
        <PermissionToggles perms={perms} onChange={setPerms} />
        <div className="settings-field">
          <label htmlFor="edit-user-password">Reset password</label>
          <input
            type="password"
            id="edit-user-password"
            name="new_password"
            data-testid="edit-user-password"
            autoComplete="new-password"
            aria-describedby="edit-user-password-hint"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
          <p className="settings-hint" id="edit-user-password-hint">
            Leave blank to keep the current password.
          </p>
        </div>
        {password !== "" && (
          <StrengthMeter strength={scorePassword(password)} />
        )}
        <ModalError error={error} />
        <div className="settings-actions">
          <Button
            type="submit"
            data-testid="edit-user-submit"
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            <BusyLabel
              busy={save.isPending}
              label="Save changes"
              busyLabel="Saving…"
            />
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/** Asks before deleting an account; the server refuses to delete the last administrator. */
export function DeleteUserModal({
  user,
  isSelf,
  onClose,
  onDeleted,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => deleteUser(user.id),
    onMutate: () => setError(null),
    onSuccess: onDeleted,
    onError: (e) => setError(e.message),
  });
  const title = `Delete ${user.username}`;

  return (
    <ConfirmModal
      testId="users-delete-modal"
      ariaLabel={title}
      dialogClass="users-modal-card"
      busy={remove.isPending}
      focusOnOpen
      onDismiss={onClose}
    >
      {isSelf && (
        <p className="settings-status error" data-testid="delete-self-warning">
          This is your own account — you'll be signed out.
        </p>
      )}
      <ModalError error={error} />
      <ConfirmBody
        title={title}
        body={`Permanently delete ${user.username} and all of their reading data. This can't be undone.`}
        actions={[
          {
            testId: "delete-user-cancel",
            label: "Cancel",
            tone: "ghost",
            disabled: remove.isPending,
            onClick: onClose,
          },
          {
            testId: "delete-user-confirm",
            label: "Delete user",
            busyLabel: "Deleting…",
            busy: remove.isPending,
            tone: "danger",
            disabled: remove.isPending,
            onClick: () => remove.mutate(),
          },
        ]}
      />
    </ConfirmModal>
  );
}

type Revoking = { kind: "session" | "device"; id: number };

function RevokeRow({
  testId,
  summary,
  revokeTestId,
  revokeLabel,
  working,
  disabled,
  onRevoke,
}: {
  testId: string;
  summary: string;
  revokeTestId: string;
  revokeLabel: string;
  working: boolean;
  disabled: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="users-session-row" data-testid={testId}>
      <span>{summary}</span>
      <Button
        variant="ghost"
        size="sm"
        className="danger"
        data-testid={revokeTestId}
        aria-label={revokeLabel}
        disabled={disabled}
        aria-busy={working}
        onClick={onRevoke}
      >
        <BusyLabel busy={working} label="Revoke" busyLabel="Revoking…" />
      </Button>
    </li>
  );
}

/** An account's live sessions and registered devices, each with a Revoke. */
export function SessionsModal({
  user,
  onClose,
}: {
  user: AdminUserRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const sessions = useQuery(userSessionsQuery(user.id));
  const devices = useQuery(userDevicesQuery(user.id));
  const revoke = useMutation({
    mutationFn: ({ kind, id }: Revoking) =>
      kind === "session" ? revokeUserSession(id) : revokeUserDevice(id),
    // Revoking a device also ends the sessions tied to it, so both lists are read again.
    onSuccess: () => {
      for (const { queryKey } of [
        userSessionsQuery(user.id),
        userDevicesQuery(user.id),
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  const working = (kind: Revoking["kind"], id: number) =>
    revoke.isPending &&
    revoke.variables.kind === kind &&
    revoke.variables.id === id;
  // A refetch in flight clears the last load's failure.
  const loadError = [sessions, devices].find(
    (q) => q.isError && !q.isFetching,
  )?.error;
  const error = revoke.error ?? loadError ?? null;

  return (
    <ModalShell
      title={`Sessions & devices — ${user.username}`}
      testId="users-sessions-modal"
      busy={false}
      onClose={onClose}
    >
      <ModalError error={error?.message ?? null} />
      {sessions.data && devices.data ? (
        <>
          <h4>Sessions</h4>
          {sessions.data.length === 0 ? (
            <p className="settings-status" data-testid="user-sessions-empty">
              No live sessions.
            </p>
          ) : (
            <ul className="users-session-list" data-testid="user-sessions-list">
              {sessions.data.map((session) => {
                const client = session.client ?? "Unknown client";
                return (
                  <RevokeRow
                    key={session.id}
                    testId="user-session-row"
                    summary={`${client} · last used ${formatUtcDay(session.last_used_at)}`}
                    revokeTestId={`user-session-revoke-${session.id}`}
                    revokeLabel={`Revoke the session on ${client}`}
                    working={working("session", session.id)}
                    disabled={revoke.isPending}
                    onRevoke={() =>
                      revoke.mutate({ kind: "session", id: session.id })
                    }
                  />
                );
              })}
            </ul>
          )}
          <h4>Devices</h4>
          {devices.data.length === 0 ? (
            <p className="settings-status" data-testid="user-devices-empty">
              No registered devices.
            </p>
          ) : (
            <ul className="users-session-list" data-testid="user-devices-list">
              {devices.data.map((device) => (
                <RevokeRow
                  key={device.id}
                  testId="user-device-row"
                  summary={`${device.name} · ${device.client_kind} · last seen ${formatUtcDay(device.last_seen_at)}`}
                  revokeTestId={`user-device-revoke-${device.id}`}
                  revokeLabel={`Revoke the device ${device.name}`}
                  working={working("device", device.id)}
                  disabled={revoke.isPending}
                  onRevoke={() =>
                    revoke.mutate({ kind: "device", id: device.id })
                  }
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        // The error line above says why the lists never arrived.
        !error && (
          <Loading
            kind="sheet"
            testId="user-sessions-loading"
            label="Reading sessions and devices…"
          />
        )
      )}
      <div className="settings-actions">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </ModalShell>
  );
}
