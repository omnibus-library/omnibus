import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  type AdminUserRow,
  adminUsersQuery,
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
import { endSession, meQuery } from "../../session";
import { EditUserSchema, NewUserSchema, permissionsOf } from "./users";

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

// While `busy` (a save is out, or the form holds edits a stray click would discard) the scrim and Escape do nothing. The cross always works.
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
  const [perms, setPerms] = useState(NEW_USER_PERMISSIONS);
  const form = useForm({
    resolver: zodResolver(NewUserSchema),
    defaultValues: { username: "", new_password: "" },
    // Typing clears a refusal, and only the next submit brings it back.
    reValidateMode: "onSubmit",
    shouldFocusError: false,
  });
  const create = useMutation({
    mutationFn: createUser,
    onSuccess: onCreated,
    onError: (e) => form.setError("root", { message: e.message }),
  });
  const { errors } = form.formState;
  const clearError = { onChange: () => form.clearErrors() };

  return (
    <ModalShell
      title="New user"
      testId="users-new-modal"
      busy={create.isPending || form.formState.isDirty}
      onClose={onClose}
    >
      <form
        className="settings-form"
        onSubmit={form.handleSubmit(({ username, new_password }) => {
          if (create.isPending) return;
          create.mutate({
            username,
            password: new_password,
            permissions: perms,
          });
        })}
      >
        <div className="settings-field">
          <label htmlFor="new-user-username">Username</label>
          <input
            type="text"
            id="new-user-username"
            data-testid="new-user-username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            {...form.register("username", clearError)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="new-user-password">Password</label>
          <input
            type="password"
            id="new-user-password"
            data-testid="new-user-password"
            autoComplete="new-password"
            {...form.register("new_password", clearError)}
          />
        </div>
        <StrengthMeter strength={scorePassword(form.watch("new_password"))} />
        <PermissionToggles perms={perms} onChange={setPerms} />
        <ModalError
          error={
            (errors.username ?? errors.new_password ?? errors.root)?.message ??
            null
          }
        />
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
 * Once the permissions land the accounts list reads again, even if the
 * password step then fails; on your own row the session reads again too, or
 * ends when your own password was reset.
 */
export function EditUserModal({
  user,
  isSelf,
  onClose,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(EditUserSchema),
    defaultValues: { permissions: permissionsOf(user), new_password: "" },
  });
  const save = useMutation({
    // The first refusal stops the save, so a rejected permission change never resets the password.
    mutationFn: async ({
      permissions,
      new_password,
    }: z.output<typeof EditUserSchema>) => {
      await setUserPermissions(user.id, permissions);
      let passwordReset = false;
      try {
        if (new_password !== "") {
          await setUserPassword(user.id, new_password);
          passwordReset = true;
        }
      } finally {
        void queryClient.invalidateQueries({
          queryKey: adminUsersQuery.queryKey,
        });
        // Changing your own permissions changes what you may see, unless the reset ends your session.
        if (isSelf && !passwordReset) {
          void queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
        }
      }
      return passwordReset;
    },
    // Your own password reset ends your own session, so there is nothing left to show.
    onSuccess: (passwordReset) =>
      isSelf && passwordReset ? endSession(queryClient, navigate) : onClose(),
    onError: (e) => form.setError("root", { message: e.message }),
  });
  const password = form.watch("new_password");

  return (
    <ModalShell
      title={`Edit ${user.username}`}
      testId="users-edit-modal"
      busy={save.isPending || form.formState.isDirty}
      onClose={onClose}
    >
      <form
        className="settings-form"
        onSubmit={form.handleSubmit((values) => {
          if (!save.isPending) save.mutate(values);
        })}
      >
        <PermissionToggles
          perms={form.watch("permissions")}
          onChange={(perms) =>
            form.setValue("permissions", perms, { shouldDirty: true })
          }
        />
        <div className="settings-field">
          <label htmlFor="edit-user-password">Reset password</label>
          <input
            type="password"
            id="edit-user-password"
            data-testid="edit-user-password"
            autoComplete="new-password"
            aria-describedby="edit-user-password-hint"
            {...form.register("new_password", {
              onChange: () => form.clearErrors(),
            })}
          />
          <p className="settings-hint" id="edit-user-password-hint">
            Leave blank to keep the current password.
          </p>
        </div>
        {password !== "" && (
          <StrengthMeter strength={scorePassword(password)} />
        )}
        <ModalError error={form.formState.errors.root?.message ?? null} />
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
    onSuccess: () =>
      Promise.all(
        [userSessionsQuery(user.id), userDevicesQuery(user.id)].map(
          ({ queryKey }) => queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
  // A refusal from before a read starts says nothing about the lists it reads; one that lands mid-read stays.
  const reloading = sessions.isFetching || devices.isFetching;
  const wasReloading = useRef(false);
  const { reset: clearRevokeError } = revoke;
  useEffect(() => {
    if (reloading && !wasReloading.current && revoke.isError) {
      clearRevokeError();
    }
    wasReloading.current = reloading;
  }, [reloading, revoke.isError, clearRevokeError]);
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
