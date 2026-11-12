import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import {
  type NotificationConnection,
  type NotificationConnections,
  notificationConnectionsQuery,
  removeNotificationConnection,
  saveNotificationConnection,
  sendTestNotification,
} from "../../api";
import { classes } from "../../classes";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { BusyLabel, RowSkeletons } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
} from "../../components/SettingsShell/SettingsShell";
import { formatStarted, nowSecs } from "../../format";
import { NotificationConnectionModal } from "./NotificationConnectionModal";
import {
  clipError,
  deliveryLine,
  isGone,
  postsTo,
  savedTestOf,
  toggledInput,
} from "./notifications";

const DOT_CLASS = {
  none: "api-key-dot",
  ok: "api-key-dot connected",
  failed: "api-key-dot failed",
} as const;

/** A failed delivery's reason, cut short when long, with the rest a click away. */
function DeliveryError({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  const { text, clipped } = clipError(error);
  return (
    <p className="notify-error" data-testid="notification-delivery-error">
      <span translate="no">{open || !clipped ? error : text}</span>
      {clipped && (
        <button
          type="button"
          className="notify-more"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </p>
  );
}

/** How the connection's last finished notification went. */
function LastDelivery({ connection }: { connection: NotificationConnection }) {
  const line = deliveryLine(connection.last_delivery, nowSecs());
  return (
    <>
      <p className="notify-delivery" data-testid="notification-last-delivery">
        <span className={DOT_CLASS[line.state]} aria-hidden="true" />
        {line.state === "none" ? (
          line.text
        ) : (
          <time
            dateTime={new Date(line.at * 1000).toISOString()}
            title={formatStarted(line.at)}
          >
            {line.text}
          </time>
        )}
      </p>
      {line.state === "failed" && <DeliveryError error={line.error} />}
    </>
  );
}

type RowProps = {
  connection: NotificationConnection;
  /** Another write on the list is out, so this row's buttons wait. */
  busy: boolean;
  onChanged: (connection: NotificationConnection) => void;
  onGone: (connection: NotificationConnection) => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** One connection: where it posts, its switch, how its last notification went, and its actions. */
function ConnectionRow({
  connection,
  busy,
  onChanged,
  onGone,
  onEdit,
  onDelete,
}: RowProps) {
  const nameId = useId();
  const { name } = connection;
  const [status, setStatus] = useState<Status | null>(null);
  const refused = (lead: string) => (error: Error) => {
    if (isGone(error)) onGone(connection);
    else setStatus({ message: `${lead}: ${error.message}`, error: true });
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      saveNotificationConnection(
        connection.id,
        toggledInput(connection, enabled),
      ),
    onMutate: () => setStatus(null),
    onSuccess: onChanged,
    onError: (error, enabled) =>
      refused(`Couldn’t turn ${enabled ? "on" : "off"} ${name}`)(error),
  });
  const test = useMutation({
    mutationFn: () => sendTestNotification(savedTestOf(connection)),
    onMutate: () => setStatus(null),
    onSuccess: () =>
      setStatus({ message: "Test notification sent.", error: false }),
    onError: refused("Test failed"),
  });
  // The switch shows where it is going while the save is out.
  const on =
    toggle.isPending && toggle.variables !== undefined
      ? toggle.variables
      : connection.enabled;
  const working = busy || toggle.isPending || test.isPending;

  return (
    <li
      className={classes("notify-row", !connection.enabled && "is-off")}
      aria-labelledby={nameId}
      data-testid="notification-row"
    >
      <div className="notify-row-head">
        <div className="notify-row-title">
          <span className="notify-name" id={nameId}>
            {name}
          </span>
          <span className="notify-kind">ntfy</span>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Send notifications to ${name}`}
            checked={on}
            aria-checked={on}
            disabled={busy || toggle.isPending}
            aria-busy={toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          <span aria-hidden="true">{on ? "On" : "Off"}</span>
        </label>
      </div>
      <p className="notify-where" translate="no">
        {postsTo(connection.settings)}
      </p>
      <LastDelivery connection={connection} />
      <div className="notify-row-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={working}
          aria-busy={test.isPending}
          aria-label={`Test ${name}`}
          onClick={() => test.mutate()}
        >
          <BusyLabel busy={test.isPending} label="Test" busyLabel="Sending…" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={working}
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={working}
          aria-label={`Delete ${name}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
      <StatusLine testId="notification-row-status" status={status} />
    </li>
  );
}

/** What the card has open over the list. */
type Open =
  | { kind: "add" }
  | { kind: "edit" | "delete"; connection: NotificationConnection }
  | null;

/** The ntfy connections the server tells when something needs someone: the list, and adding, editing, testing, turning off and deleting one. */
export function NotificationConnectionsCard() {
  const queryClient = useQueryClient();
  const list = useQuery(notificationConnectionsQuery);
  const [open, setOpen] = useState<Open>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const { queryKey } = notificationConnectionsQuery;
  const addButton = useRef<HTMLButtonElement>(null);
  // A deleted row takes the button that opened the dialog with it, so focus moves to Add instead.
  const focusAdd = useRef(false);
  useEffect(() => {
    if (open !== null || !focusAdd.current) return;
    focusAdd.current = false;
    addButton.current?.focus();
  }, [open]);

  // The answer lands at once; the read after it puts a renamed one back in name order.
  const patch = async (
    change: (connections: NotificationConnection[]) => NotificationConnection[],
  ) => {
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<NotificationConnections>(
      queryKey,
      (was) => was && { ...was, connections: change(was.connections) },
    );
    void queryClient.invalidateQueries({ queryKey });
  };
  const replaced = (connection: NotificationConnection) =>
    patch((all) => all.map((c) => (c.id === connection.id ? connection : c)));
  const gone = (connection: NotificationConnection) => {
    setOpen(null);
    setStatus({
      message: `${connection.name} had already been deleted, so the list has been read again.`,
      error: true,
    });
    void queryClient.invalidateQueries({ queryKey });
  };

  const remove = useMutation({
    mutationFn: (connection: NotificationConnection) =>
      removeNotificationConnection(connection.id),
    onMutate: () => setStatus(null),
    onSuccess: async (_, connection) => {
      await patch((all) => all.filter((c) => c.id !== connection.id));
      focusAdd.current = true;
      setStatus({ message: `${connection.name} deleted.`, error: false });
    },
    onError: (error, connection) =>
      isGone(error)
        ? gone(connection)
        : setStatus({
            message: `Couldn’t delete ${connection.name}: ${error.message}`,
            error: true,
          }),
    onSettled: () => setOpen((was) => (was?.kind === "delete" ? null : was)),
  });

  const saved = async (connection: NotificationConnection) => {
    const added = open?.kind === "add";
    setOpen(null);
    await patch((all) =>
      added
        ? [...all, connection]
        : all.map((c) => (c.id === connection.id ? connection : c)),
    );
    setStatus({
      message: `${connection.name} ${added ? "added" : "saved"}.`,
      error: false,
    });
  };

  const connections = list.data?.connections;
  const empty = connections?.length === 0;
  const loadError = list.data === undefined ? list.error : null;

  return (
    <section className="card" data-testid="notification-connections-card">
      <h3>Notification connections</h3>
      <p className="subtitle">
        Where Omnibus sends a notification when something needs someone, such as
        a book request waiting for a version to be picked. Each connection posts
        to a topic on an ntfy server, which the ntfy app on a phone or computer
        can subscribe to.
      </p>
      {list.isPending && (
        <div
          role="status"
          aria-live="polite"
          className="notify-loading"
          data-testid="notifications-loading"
        >
          <span className="ld-sr">Finding the notification connections</span>
          <RowSkeletons count={2} avatar={false} />
        </div>
      )}
      {loadError && (
        <div className="notify-load-error">
          <p
            role="alert"
            className="settings-status error"
            data-testid="notifications-load-error"
          >
            Couldn’t read the notification connections: {loadError.message}
          </p>
          <Button
            variant="ghost"
            disabled={list.isFetching}
            aria-busy={list.isFetching}
            data-testid="notifications-retry"
            onClick={() => void list.refetch()}
          >
            <BusyLabel
              busy={list.isFetching}
              label="Try again"
              busyLabel="Reading…"
            />
          </Button>
        </div>
      )}
      {empty && (
        <div className="notify-empty" data-testid="notifications-empty">
          <p className="notify-empty-title">No connections yet</p>
          <p className="settings-hint">
            Add one to get a push notification through ntfy when something needs
            you.
          </p>
        </div>
      )}
      {connections && connections.length > 0 && (
        <ul
          className="notify-list"
          aria-label="Notification connections"
          data-testid="notification-list"
        >
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              busy={remove.isPending}
              onChanged={replaced}
              onGone={gone}
              onEdit={() => setOpen({ kind: "edit", connection })}
              onDelete={() => setOpen({ kind: "delete", connection })}
            />
          ))}
        </ul>
      )}
      <div className="settings-actions">
        <StatusLine testId="notifications-status" status={status} action />
        {connections && (
          <Button
            ref={addButton}
            variant={empty ? "primary" : "default"}
            data-testid="notifications-add"
            onClick={() => {
              setStatus(null);
              setOpen({ kind: "add" });
            }}
          >
            Add connection
          </Button>
        )}
      </div>
      {list.data && (open?.kind === "add" || open?.kind === "edit") && (
        <NotificationConnectionModal
          editing={open.kind === "edit" ? open.connection : null}
          available={list.data.available_events}
          onClose={() => setOpen(null)}
          onSaved={(connection) => void saved(connection)}
          onGone={() => open.kind === "edit" && gone(open.connection)}
        />
      )}
      {open?.kind === "delete" && (
        <ConfirmDialog
          testId="notification-delete-dialog"
          title={`Delete ${open.connection.name}?`}
          body={`Omnibus stops sending to ${postsTo(open.connection.settings)}, and anything still waiting to go there is dropped.`}
          action="Delete connection"
          busyLabel="Deleting…"
          busy={remove.isPending}
          onCancel={() => setOpen(null)}
          onConfirm={() => remove.mutate(open.connection)}
        />
      )}
    </section>
  );
}
