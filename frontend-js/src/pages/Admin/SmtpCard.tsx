import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  resetSmtpConfig,
  type SmtpConfigStatus,
  saveSmtpConfig,
  sendSmtpTest,
  smtpConfigQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { BusyLabel } from "../../components/Loading/Loading";
import { useUnsavedForm } from "../../components/SettingsShell/SettingsShell";
import { CredentialStatus, LiveStatus, type Status } from "./StatusLine";
import {
  BLANK_SMTP_DRAFT,
  isSmtpEdited,
  type SmtpDraft,
  smtpDraftOf,
  smtpUpdate,
} from "./smtp";

/** The relay Send to Kindle emails through: connection fields, the saved state, and clear and test actions. */
export function SmtpCard() {
  const queryClient = useQueryClient();
  const config = useQuery(smtpConfigQuery);
  const [draft, setDraft] = useState(BLANK_SMTP_DRAFT);
  // What the form held when it was last loaded, saved or cleared; null until the relay loads.
  const [saved, setSaved] = useState<SmtpDraft | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (config.data && saved === null) {
    const loaded = smtpDraftOf(config.data);
    setSaved(loaded);
    setDraft(loaded);
  }
  useUnsavedForm("smtp", saved !== null && isSmtpEdited(saved, draft));

  const keepAnswer = async (answer: SmtpConfigStatus) => {
    await queryClient.cancelQueries({ queryKey: smtpConfigQuery.queryKey });
    queryClient.setQueryData(smtpConfigQuery.queryKey, answer);
  };
  const save = useMutation({
    mutationFn: saveSmtpConfig,
    onSuccess: keepAnswer,
  });
  const clear = useMutation({
    mutationFn: resetSmtpConfig,
    onSuccess: keepAnswer,
    onSettled: () => setConfirmingClear(false),
  });
  const test = useMutation({ mutationFn: sendSmtpTest });
  const busy = save.isPending || clear.isPending || test.isPending;

  const edit = <F extends keyof SmtpDraft>(field: F, value: SmtpDraft[F]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = smtpUpdate(saved !== null, draft);
    if (result.refused !== null) {
      setStatus({ text: result.refused, isError: true });
      return;
    }
    setStatus(null);
    const submitted = draft;
    save.mutate(result.update, {
      onSuccess: () => {
        // An edit typed meanwhile must still read as unsaved.
        setDraft((current) =>
          current.password === submitted.password
            ? { ...current, password: "" }
            : current,
        );
        setSaved({ ...submitted, password: "" });
        setStatus({ text: "SMTP settings saved.", isError: false });
      },
      onError: (error) =>
        setStatus({
          text: `Couldn’t save the SMTP settings: ${error.message}`,
          isError: true,
        }),
    });
  };

  const confirmClear = () => {
    if (busy) return;
    clear.mutate(undefined, {
      onSuccess: (answer) => {
        // What is left may be a relay from the server's environment.
        setDraft(smtpDraftOf(answer));
        setSaved(smtpDraftOf(answer));
        setStatus({ text: "SMTP settings cleared.", isError: false });
      },
      onError: (error) =>
        setStatus({
          text: `Couldn’t clear the SMTP settings: ${error.message}`,
          isError: true,
        }),
    });
  };

  const sendTest = () =>
    test.mutate(undefined, {
      onSuccess: () =>
        setStatus({
          text: "Test email sent to your Kindle address.",
          isError: false,
        }),
      onError: () =>
        setStatus({
          text: "Test email failed — check the SMTP settings and your account's Kindle email.",
          isError: true,
        }),
    });

  const configured = config.data?.configured === true;
  const readFailed =
    config.isError && !config.isFetching && config.data === undefined;
  const shown: Status | null =
    status ??
    (readFailed
      ? {
          text: `Couldn’t read the current settings: ${config.error?.message}`,
          isError: true,
        }
      : null);

  return (
    <section className="card" data-testid="smtp-card">
      <h3>Email delivery (SMTP)</h3>
      <p className="subtitle">
        The mail relay Send-to-Kindle sends books through.
      </p>
      {/* novalidate, because the browser's own range check would refuse the submit before the port's message could say why */}
      <form className="settings-form" noValidate onSubmit={submit}>
        <div className="settings-field">
          <label htmlFor="smtp-host">SMTP host</label>
          <input
            type="text"
            id="smtp-host"
            name="smtp_host"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="smtp.example.com…"
            value={draft.host}
            onChange={(e) => edit("host", e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-port">Port</label>
          <input
            type="number"
            id="smtp-port"
            name="smtp_port"
            inputMode="numeric"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(e) => edit("port", e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-security">Security</label>
          <select
            id="smtp-security"
            name="smtp_security"
            data-testid="smtp-security"
            value={draft.security}
            onChange={(e) =>
              edit("security", e.target.value === "tls" ? "tls" : "starttls")
            }
          >
            <option value="starttls">STARTTLS (587)</option>
            <option value="tls">TLS (465)</option>
          </select>
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-username">Username</label>
          <input
            type="text"
            id="smtp-username"
            name="smtp_username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={draft.username}
            onChange={(e) => edit("username", e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-password">Password</label>
          <input
            type="password"
            id="smtp-password"
            name="smtp_password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={configured ? "•••• (unchanged)" : ""}
            value={draft.password}
            onChange={(e) => edit("password", e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-from">From address</label>
          <input
            type="email"
            id="smtp-from"
            name="smtp_from_email"
            autoComplete="off"
            spellCheck={false}
            placeholder="library@example.com…"
            value={draft.fromEmail}
            onChange={(e) => edit("fromEmail", e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <CredentialStatus
            testId="smtp-status"
            configured={config.data?.configured ?? null}
            readFailed={readFailed}
            detail={config.data ? `Configured · ${config.data.source}` : ""}
            unconfigured="Not configured"
          />
          {configured && (
            <Button
              variant="ghost"
              className="danger"
              disabled={busy}
              data-testid="smtp-clear"
              onClick={() => setConfirmingClear(true)}
            >
              Clear…
            </Button>
          )}
          {readFailed && (
            <Button
              variant="ghost"
              data-testid="smtp-retry"
              onClick={() => {
                setStatus(null);
                void config.refetch();
              }}
            >
              Try again
            </Button>
          )}
          {configured && (
            <Button
              variant="ghost"
              disabled={busy}
              data-testid="smtp-test"
              onClick={sendTest}
            >
              Send test email
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || saved === null}
            aria-busy={save.isPending}
            data-testid="smtp-save"
          >
            <BusyLabel
              busy={save.isPending}
              label="Save SMTP settings"
              busyLabel="Saving…"
            />
          </Button>
        </div>
        <LiveStatus
          testId="smtp-config-status"
          message={shown?.text ?? null}
          isError={shown?.isError ?? false}
        />
      </form>
      {confirmingClear && (
        <ConfirmDialog
          testId="smtp-clear-dialog"
          title="Clear the SMTP settings?"
          body="This removes the relay host, sign-in and stored password. Send-to-Kindle stops working until the relay is set up again."
          action="Clear SMTP settings"
          busyLabel="Clearing…"
          busy={clear.isPending}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={confirmClear}
        />
      )}
    </section>
  );
}
