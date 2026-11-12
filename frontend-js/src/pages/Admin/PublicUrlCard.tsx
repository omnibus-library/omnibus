import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  ApiError,
  publicUrlQuery,
  replaceQueryData,
  savePublicUrl,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
  statusOrLoadError,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import { CredentialStatus } from "./CredentialStatus";
import { credentialState } from "./integrations";
import {
  clearedMessage,
  environmentHint,
  publicUrlDetail,
  publicUrlFieldOf,
  refusalText,
} from "./publicUrl";
import "./Admin.css";

const ERROR_ID = "public-url-error";
const HINT_ID = "public-url-hint";

/** The address the server links to from notifications: the URL saved here, or where the one in effect came from. */
export function PublicUrlCard() {
  const queryClient = useQueryClient();
  const current = useQuery(publicUrlQuery);
  // Null while the field shows what the server holds; text once the admin types.
  const [typed, setTyped] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const savedValue = publicUrlFieldOf(current.data);
  const value = typed ?? savedValue;
  useUnsavedGuard("public-url", typed !== null && typed.trim() !== savedValue);

  const write = useMutation({
    mutationFn: savePublicUrl,
    onSuccess: (answer) =>
      replaceQueryData(queryClient, publicUrlQuery.queryKey, answer),
  });
  // Clear shares the mutation, with a null URL.
  const saving = write.isPending && write.variables !== null;
  const clearing = write.isPending && write.variables === null;

  // Only what was sent goes: text typed while the request was out stays, unsaved guard and all.
  const settle = (sent: string | null) =>
    setTyped((now) => (now === sent ? null : now));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (current.data === undefined || write.isPending) return;
    const url = value.trim();
    setStatus(null);
    if (url === "") {
      setFieldError("Enter the address to save.");
      return;
    }
    setFieldError(null);
    const sent = typed;
    write.mutate(url, {
      onSuccess: () => {
        settle(sent);
        setStatus({ message: "Public URL saved.", error: false });
      },
      onError: (error) => {
        // The server's reason for refusing the address belongs beside it.
        if (error instanceof ApiError && error.status === 422) {
          setFieldError(refusalText(error.message));
          return;
        }
        setStatus({
          message: `Couldn’t save the public URL: ${error.message}`,
          error: true,
        });
      },
    });
  };

  const clear = () => {
    if (write.isPending) return;
    setStatus(null);
    setFieldError(null);
    const sent = typed;
    write.mutate(null, {
      onSuccess: (answer) => {
        settle(sent);
        setStatus(clearedMessage(answer));
      },
      onError: (error) =>
        setStatus({
          message: `Couldn’t clear the public URL: ${error.message}`,
          error: true,
        }),
    });
  };

  const failedRead = current.data === undefined ? current.error : null;
  const readFailed = failedRead !== null;
  const shown = statusOrLoadError(
    status,
    failedRead,
    "Couldn’t read the public URL: ",
  );
  const hint = environmentHint(current.data);
  const describedBy =
    [fieldError && ERROR_ID, hint && HINT_ID].filter(Boolean).join(" ") ||
    undefined;

  return (
    <section className="card" data-testid="public-url-card">
      <h3>Public server URL</h3>
      <p className="subtitle">
        The address your household reaches Omnibus at. Links in notifications
        open the request there; without it, notifications still send, just
        without a link.
      </p>
      {/* novalidate, so the server's own reason for refusing an address is the one shown */}
      <form className="settings-form" noValidate onSubmit={submit}>
        <div className="settings-field">
          <label htmlFor="public-url">Public server URL</label>
          <input
            type="url"
            id="public-url"
            name="public_url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="https://books.example.com…"
            className={current.data ? undefined : "ld-unknown"}
            disabled={current.data === undefined}
            aria-invalid={fieldError !== null}
            aria-describedby={describedBy}
            value={value}
            onChange={(e) => {
              setTyped(e.target.value);
              setFieldError(null);
              // "Saved" described the field before this edit.
              setStatus(null);
            }}
          />
          {hint && (
            <p className="settings-hint" id={HINT_ID}>
              {hint}
            </p>
          )}
          {fieldError && (
            <p className="settings-field-error" id={ERROR_ID} role="alert">
              {fieldError}
            </p>
          )}
        </div>
        <div className="settings-actions">
          <CredentialStatus
            testId="public-url-status"
            state={credentialState(
              current.data ? current.data.source !== "none" : undefined,
              readFailed,
            )}
            detail={publicUrlDetail(current.data)}
            unconfigured="Not set"
          />
          {readFailed && (
            <Button
              variant="ghost"
              data-testid="public-url-retry"
              onClick={() => {
                setStatus(null);
                void current.refetch();
              }}
            >
              Try again
            </Button>
          )}
          {current.data?.source === "settings" && (
            <Button
              variant="ghost"
              disabled={write.isPending}
              aria-busy={clearing}
              data-testid="public-url-clear"
              onClick={clear}
            >
              <BusyLabel
                busy={clearing}
                label="Clear saved URL"
                busyLabel="Clearing…"
              />
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={write.isPending || current.data === undefined}
            aria-busy={saving}
            data-testid="public-url-save"
          >
            <BusyLabel
              busy={saving}
              label="Save public URL"
              busyLabel="Saving…"
            />
          </Button>
        </div>
        <StatusLine testId="public-url-save-status" status={shown} />
      </form>
    </section>
  );
}
