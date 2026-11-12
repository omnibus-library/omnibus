import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  addNotificationConnection,
  type NotificationConnection,
  type NotificationConnectionInput,
  type NotificationEvent,
  NtfyAuth,
  saveNotificationConnection,
  sendTestNotification,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
} from "../../components/SettingsShell/SettingsShell";
import { CredentialStatus } from "./CredentialStatus";
import {
  AUTH_LABELS,
  blankDraft,
  type ConnectionDraft,
  connectionSchema,
  type DraftField,
  draftOf,
  eventChoices,
  isGone,
  NO_SAVED_SECRETS,
  PRIORITIES,
  SETTINGS_FIELDS,
  savedSecretsOf,
  secretRetypeHint,
  secretState,
  testOf,
} from "./notifications";
import { ModalShell } from "./UserModals";

type Props = {
  /** The connection to edit; null adds a new one. */
  editing: NotificationConnection | null;
  /** The events the server offers now. */
  available: NotificationEvent[];
  onClose: () => void;
  onSaved: (connection: NotificationConnection) => void;
  /** The connection being edited was deleted elsewhere. */
  onGone: () => void;
};

const id = (field: DraftField) => `notify-${field.replace("_", "-")}`;

/** Adds or edits an ntfy connection, and sends a test through the form as it stands without saving it. */
export function NotificationConnectionModal({
  editing,
  available,
  onClose,
  onSaved,
  onGone,
}: Props) {
  // Fixed for the dialog's life: what the edited connection held when it opened.
  const [saved] = useState(() =>
    editing ? savedSecretsOf(editing) : NO_SAVED_SECRETS,
  );
  const [choices] = useState(() =>
    eventChoices(available, editing?.events ?? []),
  );
  const [schema] = useState(() => connectionSchema(saved));
  const [testStatus, setTestStatus] = useState<Status | null>(null);
  const form = useForm<ConnectionDraft, unknown, NotificationConnectionInput>({
    resolver: zodResolver(schema),
    defaultValues: editing ? draftOf(editing) : blankDraft(available),
    // Re-checking is the watcher's below, so a Save and a Send test behave alike.
    reValidateMode: "onSubmit",
  });
  const { errors } = form.formState;
  // Counts edits, so a test answer that lands after one describes a draft that is gone.
  const revision = useRef(0);
  // Set by the first Save or Send test: from then on, edits re-check the fields.
  const attempted = useRef(false);
  useEffect(() => {
    const watcher = form.watch((_values, { name }) => {
      if (!name) return;
      revision.current += 1;
      // A result describes the draft it was given, not this one.
      setTestStatus(null);
      form.clearErrors("root");
      if (!attempted.current) return;
      // The field edited, and any still refused: a fixed one clears, nothing untouched is newly refused.
      const field = name.split(".")[0] as DraftField;
      const failing = Object.keys(form.formState.errors).filter(
        (key): key is DraftField => key !== "root",
      );
      void form.trigger([...new Set([field, ...failing])]);
    });
    return () => watcher.unsubscribe();
  }, [form]);

  const save = useMutation({
    // The variables carry any secret typed, so they leave the cache with the mutation.
    gcTime: 0,
    mutationFn: (input: NotificationConnectionInput) =>
      editing
        ? saveNotificationConnection(editing.id, input)
        : addNotificationConnection(input),
    onSuccess: (connection) => onSaved(connection),
    onError: (error) => {
      if (isGone(error)) {
        onGone();
        return;
      }
      form.setError("root", {
        message: `Couldn’t save the connection: ${error.message}`,
      });
    },
  });
  const test = useMutation({
    mutationFn: sendTestNotification,
    gcTime: 0,
    onMutate: () => setTestStatus(null),
  });

  const [auth, events, serverUrl, username] = form.watch([
    "auth",
    "events",
    "server_url",
    "username",
  ]);
  const shown = { auth, server_url: serverUrl, username };
  const tokenState = secretState(shown, saved, "token");
  const passwordState = secretState(shown, saved, "password");
  const keepsToken = tokenState === "kept";
  const keepsPassword = passwordState === "kept";
  // The reason is the refusal's text too, so it isn't said twice.
  const tokenHint = errors.token ? null : secretRetypeHint(tokenState, "token");
  const passwordHint = errors.password
    ? null
    : secretRetypeHint(passwordState, "password");

  const sendTest = async () => {
    if (test.isPending) return;
    attempted.current = true;
    // A test needs only the settings: a missing name isn't a reason to refuse it.
    if (!(await form.trigger(SETTINGS_FIELDS, { shouldFocus: true }))) {
      setTestStatus({
        message: "Fix the fields above before sending a test.",
        error: true,
      });
      return;
    }
    const sentAt = revision.current;
    const current = (status: Status) => {
      if (revision.current === sentAt) setTestStatus(status);
    };
    test.mutate(testOf(form.getValues(), editing?.id ?? null), {
      onSuccess: () =>
        current({ message: "Test notification sent.", error: false }),
      onError: (error) => {
        if (isGone(error)) onGone();
        else current({ message: `Test failed: ${error.message}`, error: true });
      },
    });
  };

  const toggleEvent = (event: NotificationEvent, on: boolean) =>
    form.setValue(
      "events",
      on ? [...events, event] : events.filter((e) => e !== event),
      { shouldDirty: true },
    );

  // Each field names its hint and its refusal, when it has them.
  const described = (field: DraftField, hint = false) => {
    const ids = [
      hint && `${id(field)}-hint`,
      errors[field] && `${id(field)}-error`,
    ].filter(Boolean);
    return {
      id: id(field),
      "aria-invalid": errors[field] !== undefined,
      "aria-describedby": ids.length ? ids.join(" ") : undefined,
    };
  };
  const refusal = (field: DraftField) => {
    const message = errors[field]?.message;
    return (
      message && (
        <p className="settings-field-error" id={`${id(field)}-error`}>
          {message}
        </p>
      )
    );
  };

  return (
    <ModalShell
      title={editing ? `Edit ${editing.name}` : "New ntfy connection"}
      testId="notification-connection-modal"
      busy={save.isPending || form.formState.isDirty}
      locked={save.isPending}
      onClose={onClose}
    >
      <form
        className="settings-form notify-form"
        noValidate
        onSubmit={(e) => {
          attempted.current = true;
          void form.handleSubmit((input) => {
            if (!save.isPending) save.mutate(input);
          })(e);
        }}
      >
        <div className="settings-field">
          <label htmlFor={id("name")}>Name</label>
          <input
            type="text"
            autoComplete="off"
            placeholder="e.g. Phone…"
            {...described("name")}
            {...form.register("name")}
          />
          {refusal("name")}
        </div>
        <div className="settings-field">
          <label htmlFor={id("server_url")}>Server URL</label>
          <input
            type="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="https://ntfy.sh"
            {...described("server_url")}
            {...form.register("server_url")}
          />
          {refusal("server_url")}
        </div>
        <div className="settings-field">
          <label htmlFor={id("topic")}>Topic</label>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="omnibus-requests…"
            {...described("topic", true)}
            {...form.register("topic")}
          />
          <p className="settings-hint" id={`${id("topic")}-hint`}>
            Subscribe to this topic in the ntfy app to get the notifications.
          </p>
          {refusal("topic")}
        </div>
        <div className="settings-field">
          <label htmlFor={id("auth")}>Sign-in</label>
          <select {...described("auth")} {...form.register("auth")}>
            {NtfyAuth.options.map((mode) => (
              <option key={mode} value={mode}>
                {AUTH_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        {auth === "token" && (
          <div className="settings-field">
            <label htmlFor={id("token")}>Access token</label>
            <input
              type="password"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={
                keepsToken ? "Leave blank to keep the saved token" : "tk_…"
              }
              {...described("token", tokenHint !== null)}
              {...form.register("token")}
            />
            {keepsToken && (
              <CredentialStatus
                testId="notify-token-status"
                state="configured"
                detail="A token is saved"
                unconfigured=""
              />
            )}
            {tokenHint && (
              <p className="settings-hint" id={`${id("token")}-hint`}>
                {tokenHint}
              </p>
            )}
            {refusal("token")}
          </div>
        )}
        {auth === "basic" && (
          <>
            <div className="settings-field">
              <label htmlFor={id("username")}>Username</label>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                {...described("username")}
                {...form.register("username")}
              />
              {refusal("username")}
            </div>
            <div className="settings-field">
              <label htmlFor={id("password")}>Password</label>
              <input
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={
                  keepsPassword ? "Leave blank to keep the saved password" : ""
                }
                {...described("password", passwordHint !== null)}
                {...form.register("password")}
              />
              {keepsPassword && (
                <CredentialStatus
                  testId="notify-password-status"
                  state="configured"
                  detail="A password is saved"
                  unconfigured=""
                />
              )}
              {passwordHint && (
                <p className="settings-hint" id={`${id("password")}-hint`}>
                  {passwordHint}
                </p>
              )}
              {refusal("password")}
            </div>
          </>
        )}
        <div className="settings-field">
          <label htmlFor={id("priority")}>Priority</label>
          <select {...described("priority")} {...form.register("priority")}>
            {PRIORITIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label htmlFor={id("tags")}>Tags (optional)</label>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="books, bell…"
            {...described("tags", true)}
            {...form.register("tags")}
          />
          <p className="settings-hint" id={`${id("tags")}-hint`}>
            Separate tags with commas. A tag that names an emoji, such as books,
            shows as that emoji.
          </p>
        </div>
        <div className="notify-toggle">
          <label className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              aria-checked={form.watch("include_details")}
              aria-describedby={`${id("include_details")}-hint`}
              {...form.register("include_details")}
            />
            Include book and requester details
          </label>
          <p className="settings-hint" id={`${id("include_details")}-hint`}>
            Turned off, the message leaves out the book’s title and who asked,
            for a topic other people can read.
          </p>
        </div>
        <fieldset className="users-perms notify-events">
          <legend>Send a notification when</legend>
          {choices.length === 0 ? (
            <p className="settings-hint" data-testid="notify-events-none">
              Request events are available when book requests are turned on.
            </p>
          ) : (
            choices.map(({ event, label, offered }) => (
              <div key={event}>
                <label className="users-perm-row">
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    aria-describedby={
                      offered ? undefined : `notify-event-${event}-hint`
                    }
                    onChange={(e) => toggleEvent(event, e.target.checked)}
                  />
                  <span>{label}</span>
                </label>
                {!offered && (
                  <p
                    className="settings-hint users-perm-hint"
                    id={`notify-event-${event}-hint`}
                  >
                    Not sent while book requests are off. It stays chosen for
                    when they’re back on.
                  </p>
                )}
              </div>
            ))
          )}
        </fieldset>
        <label className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            aria-checked={form.watch("enabled")}
            {...form.register("enabled")}
          />
          Send notifications through this connection
        </label>
        {errors.root?.message && (
          <p
            role="alert"
            className="settings-status error"
            data-testid="notify-form-error"
          >
            {errors.root.message}
          </p>
        )}
        <StatusLine
          testId="notify-test-status"
          status={
            test.isPending
              ? { message: "Sending a test notification…", error: false }
              : testStatus
          }
          pending={test.isPending}
        />
        <div className="settings-actions">
          <Button
            variant="ghost"
            className="settings-action-start"
            disabled={test.isPending || save.isPending}
            aria-busy={test.isPending}
            data-testid="notify-test"
            onClick={() => void sendTest()}
          >
            <BusyLabel
              busy={test.isPending}
              label="Send test"
              busyLabel="Sending…"
            />
          </Button>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={save.isPending}
            aria-busy={save.isPending}
            data-testid="notify-save"
          >
            <BusyLabel
              busy={save.isPending}
              label="Save connection"
              busyLabel="Saving…"
            />
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
