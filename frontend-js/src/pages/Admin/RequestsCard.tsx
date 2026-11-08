import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  DownloadClientKind,
  type RequestsSettingsStatus,
  replaceQueryData,
  requestsSettingsQuery,
  saveRequestsSettings,
  testDownloadClient,
  testProwlarr,
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
import {
  BLANK_REQUESTS_DRAFT,
  CLIENTS,
  RequestsSchema,
  requestsDraftOf,
} from "./requests";

type TestTarget = "prowlarr" | "client";

type SecretField = "prowlarr_api_key" | "download_client_password";

/** What clearing each secret asks, says and confirms; the download client's follows the client it is for. */
function secretClears(client: (typeof CLIENTS)[DownloadClientKind]) {
  const clears: Record<
    SecretField,
    { title: string; body: string; action: string; done: string }
  > = {
    prowlarr_api_key: {
      title: "Clear the Prowlarr API key?",
      body: "Searching stops until a key is set again, unless the server has OMNIBUS_PROWLARR_API_KEY set, which then takes over.",
      action: "Clear API key",
      done: "Prowlarr API key cleared.",
    },
    download_client_password: {
      title: `Clear the ${client.name} ${client.secret}?`,
      body: `Downloads stop until the ${client.secret} is set again, unless ${client.name} lets Omnibus in without one.`,
      action: `Clear ${client.secret}`,
      done: `${client.name} ${client.secret} cleared.`,
    },
  };
  return clears;
}

const TARGET_NAMES: Record<TestTarget, string> = {
  prowlarr: "Prowlarr",
  client: "The download client",
};

/** The Prowlarr and download client connections book requests run on: addresses, logins, the folder mapping, and a test button for each connection. */
export function RequestsCard() {
  const queryClient = useQueryClient();
  const saved = useQuery(requestsSettingsQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const [clearing, setClearing] = useState<SecretField | null>(null);
  const form = useForm({
    resolver: zodResolver(RequestsSchema),
    defaultValues: BLANK_REQUESTS_DRAFT,
    // Each read fills the form, but never over a typed edit.
    values: saved.data ? requestsDraftOf(saved.data) : undefined,
    resetOptions: { keepDirtyValues: true },
    shouldFocusError: false,
  });
  useUnsavedGuard("requests", form.formState.isDirty);
  // The fields follow the client chosen in the form; what acts on the saved settings follows the saved one.
  const client = CLIENTS[form.watch("download_client_kind")];
  const savedClient =
    CLIENTS[saved.data?.download_client_kind ?? "qbittorrent"];
  const clears = secretClears(savedClient);

  const keepAnswer = (answer: RequestsSettingsStatus) =>
    replaceQueryData(queryClient, requestsSettingsQuery.queryKey, answer);
  const save = useMutation({
    mutationFn: saveRequestsSettings,
    onSuccess: keepAnswer,
  });
  const clear = useMutation({
    mutationFn: saveRequestsSettings,
    onSuccess: keepAnswer,
    onSettled: () => setClearing(null),
  });
  const test = useMutation({
    mutationFn: (target: TestTarget) =>
      target === "prowlarr" ? testProwlarr() : testDownloadClient(),
  });
  const busy = save.isPending || clear.isPending || test.isPending;

  const submit = form.handleSubmit(
    (update) => {
      // Save writes every field, so it waits for the loaded settings: blanks saved over a failed read would wipe them.
      if (saved.data === undefined) {
        setStatus({
          message:
            "The current request settings haven’t loaded, so saving now would overwrite them.",
          error: true,
        });
        return;
      }
      setStatus(null);
      save.mutate(update, {
        onSuccess: () => {
          // A secret typed meanwhile must still read as unsaved.
          for (const field of [
            "prowlarr_api_key",
            "download_client_password",
          ] as const) {
            if (form.getValues(field) === (update[field] ?? "")) {
              form.resetField(field);
            }
          }
          setStatus({ message: "Request settings saved.", error: false });
        },
        onError: (error) =>
          setStatus({
            message: `Couldn’t save the request settings: ${error.message}`,
            error: true,
          }),
      });
    },
    () =>
      setStatus({
        message: "Nothing saved yet. Check the addresses marked above.",
        error: true,
      }),
  );

  const confirmClear = (field: SecretField) => {
    if (busy || saved.data === undefined) return;
    // Only the one secret is sent, with the saved values for the rest: typed edits stay unsaved in the form.
    const update = {
      ...RequestsSchema.parse(requestsDraftOf(saved.data)),
      [field]: "",
    };
    clear.mutate(update, {
      onSuccess: () => setStatus({ message: clears[field].done, error: false }),
      onError: (error) =>
        setStatus({
          message: `Couldn’t clear it: ${error.message}`,
          error: true,
        }),
    });
  };

  const runTest = (target: TestTarget) =>
    test.mutate(target, {
      onSuccess: () =>
        setStatus({
          message: `${TARGET_NAMES[target]} answered and accepted the saved settings.`,
          error: false,
        }),
      onError: (error) =>
        setStatus({
          message: `${TARGET_NAMES[target]} test failed: ${error.message}`,
          error: true,
        }),
    });
  const testing = (target: TestTarget) =>
    test.isPending && test.variables === target;

  const connected =
    saved.data === undefined
      ? undefined
      : Boolean(
          saved.data.prowlarr_url &&
            saved.data.prowlarr_api_key_source !== "none" &&
            saved.data.download_client_url,
        );
  // A value not yet read is shown unknown and can't be edited over.
  const unknown = {
    className: saved.data ? undefined : "ld-unknown",
    disabled: saved.data === undefined,
  };
  const urlErrors = form.formState.errors;
  const addressProps = (field: "prowlarr_url" | "download_client_url") => {
    const message = urlErrors[field]?.message;
    return {
      "aria-invalid": message !== undefined,
      "aria-describedby": message ? `requests-${field}-error` : undefined,
    };
  };
  const addressError = (field: "prowlarr_url" | "download_client_url") => {
    const message = urlErrors[field]?.message;
    return (
      message && (
        <p className="settings-field-error" id={`requests-${field}-error`}>
          {message}
        </p>
      )
    );
  };
  const failedRead = saved.data === undefined ? saved.error : null;
  const readFailed = failedRead !== null;
  const shown = statusOrLoadError(
    status,
    failedRead,
    "Couldn’t read the current settings: ",
  );

  return (
    <section className="card" data-testid="requests-card">
      <h3>Book requests</h3>
      <p className="subtitle">
        Where Omnibus searches for books (Prowlarr) and downloads them (
        {savedClient.name}). The test buttons check what is saved, so save
        first.
      </p>
      <form className="settings-form" noValidate onSubmit={submit}>
        <div className="settings-field">
          <label htmlFor="requests-prowlarr-url">Prowlarr address</label>
          <input
            type="url"
            id="requests-prowlarr-url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="http://prowlarr:9696…"
            {...unknown}
            {...addressProps("prowlarr_url")}
            {...form.register("prowlarr_url", heldTrimmed)}
          />
          {addressError("prowlarr_url")}
        </div>
        <div className="settings-field">
          <label htmlFor="requests-prowlarr-key">Prowlarr API key</label>
          <input
            type="password"
            id="requests-prowlarr-key"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              saved.data?.prowlarr_api_key_masked
                ? `${saved.data.prowlarr_api_key_masked} (unchanged)`
                : ""
            }
            {...unknown}
            {...form.register("prowlarr_api_key")}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="requests-client-kind">Download client</label>
          <select
            id="requests-client-kind"
            data-testid="requests-client-kind"
            {...unknown}
            {...form.register("download_client_kind")}
          >
            {DownloadClientKind.options.map((kind) => (
              <option key={kind} value={kind}>
                {CLIENTS[kind].name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label htmlFor="requests-client-url">{client.name} address</label>
          <input
            type="url"
            id="requests-client-url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={client.addressPlaceholder}
            {...unknown}
            {...addressProps("download_client_url")}
            {...form.register("download_client_url", heldTrimmed)}
          />
          {addressError("download_client_url")}
        </div>
        {client.hasUsername && (
          <div className="settings-field">
            <label htmlFor="requests-client-username">
              {client.name} username
            </label>
            <input
              type="text"
              id="requests-client-username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              {...unknown}
              {...form.register("download_client_username", heldTrimmed)}
            />
          </div>
        )}
        <div className="settings-field">
          <label htmlFor="requests-client-password">
            {client.name} {client.secret}
          </label>
          <input
            type="password"
            id="requests-client-password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              saved.data?.download_client_password_masked
                ? "•••• (unchanged)"
                : ""
            }
            {...unknown}
            {...form.register("download_client_password")}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="requests-client-category">
            {client.name} {client.category} (optional)
          </label>
          <input
            type="text"
            id="requests-client-category"
            aria-describedby="requests-client-category-hint"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            {...unknown}
            {...form.register("download_client_category", heldTrimmed)}
          />
          <p className="settings-hint" id="requests-client-category-hint">
            Files Omnibus downloads under this {client.name} {client.category}.
            Leave empty to use {client.name}’s defaults.
          </p>
        </div>
        <div className="settings-field">
          <label htmlFor="requests-client-folder">
            Completed folder, as {client.name} sees it
          </label>
          <input
            type="text"
            id="requests-client-folder"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="/downloads…"
            {...unknown}
            {...form.register("download_client_path_prefix", heldTrimmed)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="requests-server-folder">
            The same folder, as Omnibus sees it
          </label>
          <input
            type="text"
            id="requests-server-folder"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="/mnt/downloads…"
            {...unknown}
            {...form.register("download_path_prefix", heldTrimmed)}
          />
        </div>
        <div className="settings-actions">
          <CredentialStatus
            testId="requests-status"
            state={credentialState(connected, readFailed)}
            detail={`Prowlarr and ${savedClient.name} set up`}
            unconfigured="Not set up"
          />
          {readFailed && (
            <Button
              variant="ghost"
              data-testid="requests-retry"
              onClick={() => {
                setStatus(null);
                void saved.refetch();
              }}
            >
              Try again
            </Button>
          )}
          {saved.data?.prowlarr_api_key_source === "settings" && (
            <Button
              variant="ghost"
              className="danger"
              disabled={busy}
              data-testid="requests-clear-prowlarr-key"
              onClick={() => setClearing("prowlarr_api_key")}
            >
              Clear API key…
            </Button>
          )}
          {saved.data?.download_client_password_masked && (
            <Button
              variant="ghost"
              className="danger"
              disabled={busy}
              data-testid="requests-clear-client-password"
              onClick={() => setClearing("download_client_password")}
            >
              Clear {savedClient.secret}…
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={
              busy || saved.data === undefined || form.formState.isDirty
            }
            aria-busy={testing("prowlarr")}
            data-testid="requests-test-prowlarr"
            onClick={() => runTest("prowlarr")}
          >
            <BusyLabel
              busy={testing("prowlarr")}
              label="Test Prowlarr"
              busyLabel="Testing…"
            />
          </Button>
          <Button
            variant="ghost"
            disabled={
              busy || saved.data === undefined || form.formState.isDirty
            }
            aria-busy={testing("client")}
            data-testid="requests-test-client"
            onClick={() => runTest("client")}
          >
            <BusyLabel
              busy={testing("client")}
              label={`Test ${savedClient.name}`}
              busyLabel="Testing…"
            />
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || saved.data === undefined}
            aria-busy={save.isPending}
            data-testid="requests-save"
          >
            <BusyLabel
              busy={save.isPending}
              label="Save request settings"
              busyLabel="Saving…"
            />
          </Button>
        </div>
        <StatusLine testId="requests-config-status" status={shown} />
      </form>
      {clearing && (
        <ConfirmDialog
          testId="requests-clear-dialog"
          title={clears[clearing].title}
          body={clears[clearing].body}
          action={clears[clearing].action}
          busyLabel="Clearing…"
          busy={clear.isPending}
          onCancel={() => setClearing(null)}
          onConfirm={() => confirmClear(clearing)}
        />
      )}
    </section>
  );
}
