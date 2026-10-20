import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  replaceQueryData,
  resetSmtpConfig,
  type SmtpConfigStatus,
  saveSmtpConfig,
  sendSmtpTest,
  smtpConfigQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  heldTrimmed,
  type Status,
  StatusLine,
  statusOrLoadError,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import { CredentialStatus } from "./CredentialStatus";
import { credentialState } from "./integrations";
import { BLANK_SMTP_DRAFT, SmtpSchema, smtpDraftOf } from "./smtp";

/** The relay Send to Kindle emails through: connection fields, the saved state, and clear and test actions. */
export function SmtpCard() {
  const queryClient = useQueryClient();
  const config = useQuery(smtpConfigQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const form = useForm({
    resolver: zodResolver(SmtpSchema),
    defaultValues: BLANK_SMTP_DRAFT,
    // Each read fills the form, but never over a typed edit.
    values: config.data ? smtpDraftOf(config.data) : undefined,
    resetOptions: { keepDirtyValues: true },
    shouldFocusError: false,
  });
  useUnsavedGuard("smtp", form.formState.isDirty);

  const keepAnswer = (answer: SmtpConfigStatus) =>
    replaceQueryData(queryClient, smtpConfigQuery.queryKey, answer);
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

  const submit = form.handleSubmit(
    (update) => {
      // Save writes every field, so it waits for the loaded relay: blanks saved over a failed read would wipe it.
      if (config.data === undefined) {
        setStatus({
          message:
            "The current SMTP settings haven’t loaded, so saving now would overwrite them.",
          error: true,
        });
        return;
      }
      setStatus(null);
      save.mutate(update, {
        onSuccess: () => {
          // A password typed meanwhile must still read as unsaved.
          if (form.getValues("smtp_password") === update.password) {
            form.resetField("smtp_password");
          }
          setStatus({ message: "SMTP settings saved.", error: false });
        },
        onError: (error) =>
          setStatus({
            message: `Couldn’t save the SMTP settings: ${error.message}`,
            error: true,
          }),
      });
    },
    (errors) =>
      setStatus({ message: errors.smtp_port?.message ?? "", error: true }),
  );

  const confirmClear = () => {
    if (busy) return;
    clear.mutate(undefined, {
      onSuccess: (answer) => {
        // What is left may be a relay from the server's environment.
        form.reset(smtpDraftOf(answer), { keepDirtyValues: false });
        setStatus({ message: "SMTP settings cleared.", error: false });
      },
      onError: (error) =>
        setStatus({
          message: `Couldn’t clear the SMTP settings: ${error.message}`,
          error: true,
        }),
    });
  };

  const sendTest = () =>
    test.mutate(undefined, {
      onSuccess: () =>
        setStatus({
          message: "Test email sent to your Kindle address.",
          error: false,
        }),
      onError: () =>
        setStatus({
          message:
            "Test email failed — check the SMTP settings and your account's Kindle email.",
          error: true,
        }),
    });

  const configured = config.data?.configured === true;
  const failedRead = config.data === undefined ? config.error : null;
  const readFailed = failedRead !== null;
  const shown = statusOrLoadError(
    status,
    failedRead,
    "Couldn’t read the current settings: ",
  );

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
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="smtp.example.com…"
            {...form.register("smtp_host", heldTrimmed)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-port">Port</label>
          <input
            type="number"
            id="smtp-port"
            inputMode="numeric"
            min={1}
            max={65535}
            {...form.register("smtp_port", heldTrimmed)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-security">Security</label>
          <select
            id="smtp-security"
            data-testid="smtp-security"
            {...form.register("smtp_security")}
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
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            {...form.register("smtp_username", heldTrimmed)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-password">Password</label>
          <input
            type="password"
            id="smtp-password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={configured ? "•••• (unchanged)" : ""}
            {...form.register("smtp_password")}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="smtp-from">From address</label>
          <input
            type="email"
            id="smtp-from"
            autoComplete="off"
            spellCheck={false}
            placeholder="library@example.com…"
            {...form.register("smtp_from_email", heldTrimmed)}
          />
        </div>
        <div className="settings-actions">
          <CredentialStatus
            testId="smtp-status"
            state={credentialState(config.data?.configured, readFailed)}
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
            disabled={busy || config.data === undefined}
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
        <StatusLine testId="smtp-config-status" status={shown} />
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
