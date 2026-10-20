import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  googleBooksConfiguredQuery,
  type SecretKeyKind,
  saveSecretKey,
  secretKeyQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { BusyLabel } from "../../components/Loading/Loading";
import { useUnsavedForm } from "../../components/SettingsShell/SettingsShell";
import { clearWarning, SECRET_KEYS } from "./integrations";
import { CredentialStatus, LiveStatus, type Status } from "./StatusLine";

/** A server-wide key the admin sets: its masked state, a field to replace it, and a way to remove it. */
export function SecretKeyCard({ kind }: { kind: SecretKeyKind }) {
  const copy = SECRET_KEYS[kind];
  const queryClient = useQueryClient();
  const current = useQuery(secretKeyQuery(kind));
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  useUnsavedForm(copy.testId, typed.trim() !== "");

  const write = useMutation({
    mutationFn: (key: string | null) => saveSecretKey(kind, key),
    onSuccess: async (answer) => {
      await queryClient.cancelQueries({
        queryKey: secretKeyQuery(kind).queryKey,
      });
      queryClient.setQueryData(secretKeyQuery(kind).queryKey, answer);
      if (kind === "google-books") {
        // Check-in reads whether a key is set to decide how it warns about the quota.
        void queryClient.invalidateQueries({
          queryKey: googleBooksConfiguredQuery.queryKey,
        });
      }
    },
    onSettled: () => setConfirmingClear(false),
  });

  // The clear button shares the mutation, with a null key.
  const saving = write.isPending && write.variables !== null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = typed.trim();
    // Removing a key is the Clear button's job, so a blank save never wipes it.
    if (key === "") {
      setStatus({ text: `Enter a ${copy.noun} key to save.`, isError: true });
      return;
    }
    setStatus(null);
    write.mutate(key, {
      onSuccess: () => {
        setTyped("");
        setStatus({ text: `${copy.noun} key saved.`, isError: false });
      },
      onError: (error) =>
        setStatus({
          text: `Couldn’t save the ${copy.noun} key: ${error.message}`,
          isError: true,
        }),
    });
  };

  const confirmClear = () => {
    if (write.isPending) return;
    write.mutate(null, {
      onSuccess: () => {
        setTyped("");
        setStatus({ text: `${copy.noun} key cleared.`, isError: false });
      },
      onError: (error) =>
        setStatus({
          text: `Couldn’t clear the ${copy.noun} key: ${error.message}`,
          isError: true,
        }),
    });
  };

  const readFailed =
    current.isError && !current.isFetching && current.data === undefined;
  const shown: Status | null =
    status ??
    (readFailed
      ? {
          text: `Couldn’t read the current status: ${current.error?.message}`,
          isError: true,
        }
      : null);
  const masked = current.data?.masked;

  return (
    <section className="card" data-testid={`${copy.testId}-key-card`}>
      <h3>{copy.heading}</h3>
      <p className="subtitle">{copy.subtitle}</p>
      <form className="settings-form" onSubmit={submit}>
        <div className="settings-field">
          <label htmlFor={copy.inputId}>{copy.label}</label>
          <input
            type="password"
            id={copy.inputId}
            name={copy.inputName}
            // A server-wide secret: keep password managers, autofill and spellcheck from storing or mangling it.
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={masked ?? copy.placeholder}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <CredentialStatus
            testId={`${copy.testId}-status`}
            configured={current.data?.configured ?? null}
            readFailed={readFailed}
            detail={
              current.data
                ? `Connected · ${current.data.source} · ${masked ?? ""}`
                : ""
            }
            unconfigured="Not connected"
          />
          {current.data?.configured && (
            <Button
              variant="ghost"
              className="danger"
              disabled={write.isPending}
              data-testid={`${copy.testId}-clear`}
              onClick={() => setConfirmingClear(true)}
            >
              Clear…
            </Button>
          )}
          {readFailed && (
            <Button
              variant="ghost"
              data-testid={`${copy.testId}-retry`}
              onClick={() => {
                setStatus(null);
                void current.refetch();
              }}
            >
              Try again
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={write.isPending || current.data === undefined}
            aria-busy={saving}
            data-testid={`${copy.testId}-save`}
          >
            <BusyLabel
              busy={saving}
              label={`Save ${copy.noun} key`}
              busyLabel="Saving…"
            />
          </Button>
        </div>
        <LiveStatus testId={`${copy.testId}-key-status`} status={shown} />
      </form>
      {confirmingClear && (
        <ConfirmDialog
          testId={`${copy.testId}-clear-dialog`}
          title={`Remove the ${copy.noun} key?`}
          body={clearWarning(kind)}
          action={`Remove ${copy.noun} key`}
          busyLabel="Clearing…"
          busy={write.isPending}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={confirmClear}
        />
      )}
    </section>
  );
}
