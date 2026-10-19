import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { revokeSession, type SessionView, sessionsQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { RowSkeletons } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
} from "../../components/SettingsShell/SettingsShell";
import { utcDay } from "../../format";

const clientOf = (session: SessionView) => session.client ?? "Unknown client";

/** The reader's live sign-ins; each other one can be revoked, after asking. */
export function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState<SessionView | null>(null);
  const revoke = useMutation({
    mutationFn: (session: SessionView) => revokeSession(session.id),
    onMutate: () => setStatus(null),
    onSuccess: () => setStatus({ message: "Session revoked.", error: false }),
    onError: (error) => setStatus({ message: error.message, error: true }),
    onSettled: () => {
      setConfirming(null);
      // Either way the list shows what the server now holds.
      return queryClient.invalidateQueries({
        queryKey: sessionsQuery.queryKey,
      });
    },
  });
  const shown =
    status ??
    (sessions.isError
      ? { message: sessions.error.message, error: true }
      : null);

  return (
    <section className="card" data-testid="account-sessions-card">
      <h3>Sessions</h3>
      <p className="subtitle">
        Devices and browsers currently signed in to your account.
      </p>
      {sessions.isPending && (
        <div
          role="status"
          aria-live="polite"
          data-testid="account-sessions-loading"
        >
          <span className="ld-sr">Finding your sessions</span>
          <RowSkeletons count={2} avatar={false} />
        </div>
      )}
      {sessions.data?.length === 0 && (
        <p className="settings-status" data-testid="account-sessions-empty">
          No sessions found.
        </p>
      )}
      {sessions.data && sessions.data.length > 0 && (
        <div className="table-scroll">
          <table className="users-table" data-testid="account-sessions-list">
            <thead>
              <tr>
                <th>Client</th>
                <th>Signed in</th>
                <th>Last used</th>
                <th className="users-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((session) => (
                <tr key={session.id} data-testid="account-session-row">
                  <td>
                    <span className="users-name">{clientOf(session)}</span>
                    {session.is_current && (
                      <span className="users-self-tag"> (this device)</span>
                    )}
                  </td>
                  <td>{utcDay(session.created_at)}</td>
                  <td>{utcDay(session.last_used_at)}</td>
                  <td className="users-col-actions">
                    {!session.is_current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="danger"
                        disabled={revoke.isPending}
                        aria-label={`Revoke the session on ${clientOf(session)}`}
                        data-testid={`account-session-revoke-${session.id}`}
                        onClick={() => setConfirming(session)}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StatusLine testId="account-sessions-status" status={shown} />
      {confirming && (
        <ConfirmDialog
          testId="session-revoke-dialog"
          title={`Sign out ${clientOf(confirming)}?`}
          body="It is signed out at once and has to sign in again."
          action="Revoke session"
          busyLabel="Revoking…"
          busy={revoke.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => revoke.mutate(confirming)}
        />
      )}
    </section>
  );
}
