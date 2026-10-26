import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  createKoboDevice,
  type DeviceKind,
  deleteKoboDevice,
  generateKosyncPassword,
  type KoboDeviceView,
  type KosyncPassword,
  koboDevicesQuery,
} from "../../api";
import { classes } from "../../classes";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { CopyButton } from "../../components/CopyButton/CopyButton";
import { RowSkeletons } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
  statusOrLoadError,
} from "../../components/SettingsShell/SettingsShell";
import { formatUtcDay, nowSecs } from "../../format";
import { useCurrentUser } from "../../session";
import { DeviceAddForm, useNameForm } from "./DeviceAddForm";

/** A plugin row says "Added just now" for this many seconds after the device is created. */
const JUST_ADDED_SECS = 60;

const isKoreader = (device: KoboDeviceView) =>
  device.kind === "koreader" || device.kind === "kosync";

const noPluginNames = (devices: KoboDeviceView[]) =>
  devices.filter((d) => d.kind === "kosync").map((d) => d.name);

/** `names` as a sentence fragment: "A", "A and B", "A, B and C". */
const joinNames = (names: string[]) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const pluginUrl = (id: number) =>
  `/api/account/kobo-devices/${id}/koreader-plugin`;

/** When a plugin row says the device was added: "just now" for a minute, then the date. */
const addedLabel = (createdAt: number, now: number) =>
  now - createdAt < JUST_ADDED_SECS
    ? "Added just now"
    : `Added ${formatUtcDay(createdAt)}`;

/** The card status line after `device` was added. */
function addedMessage(device: KoboDeviceView): string {
  if (device.kind !== "kosync")
    return `Added ${device.name}. Download its plugin and put it on the device.`;
  return device.kosync_login
    ? `Added ${device.name}. Copy its login now: the password is shown once.`
    : `Added ${device.name}.`;
}

/** The generate dialog's text, naming every no-plugin KOReader it signs out. */
function generateConfirmText(names: string[]) {
  const [verb, its, them] =
    names.length === 1 ? ["stops", "its", "it"] : ["stop", "their", "them"];
  return {
    title: "Generate a new Progress sync password?",
    body: `${joinNames(names)} ${verb} syncing ${its} place until you log in on ${them} again with the new password. Every no-plugin KOReader shares this one login. Plugin KOReaders and Kobos aren’t affected.`,
  };
}

/** A remove dialog's text; the last no-plugin KOReader also takes the Progress sync login with it. */
function removeConfirmText(name: string, lastNoPlugin: boolean) {
  return {
    title: `Remove ${name}?`,
    body: lastNoPlugin
      ? `${name} stops syncing with Omnibus. It’s your last no-plugin KOReader, so this also turns off Progress sync: its password stops working.`
      : `${name} stops syncing with Omnibus. To sync it again, add it as a new device.`,
  };
}

/** What a no-plugin row shows under its name this session; none of it survives a reload. */
type Panel =
  | { kind: "fresh"; login: KosyncPassword }
  | { kind: "reuse" }
  | { kind: "regenerated"; login: KosyncPassword };

type Pending =
  | { action: "remove"; device: KoboDeviceView; lastNoPlugin: boolean }
  | { action: "generate"; id: number; names: string[] };

/** How to connect a KOReader, open by default only for a reader with none yet. */
function Setup({ open }: { open: boolean }) {
  return (
    <details className="kobo-setup" data-testid="koreader-setup" open={open}>
      <summary className="kobo-setup-summary">
        How to connect a KOReader
      </summary>
      <ol
        className="subtitle kobo-setup-steps"
        data-testid="koreader-setup-steps"
      >
        <li>
          Give your KOReader a name and click <b>Add a KOReader</b> below.
        </li>
        <li>
          Click <b>Download plugin</b> on its row. The zip is already set to
          this server and this KOReader. Anyone holding it can sync as you, so
          don’t share it.
        </li>
        <li>
          Unzip it so the <code translate="no">omnibus.koplugin</code> folder
          sits in KOReader’s plugins folder:{" "}
          <code translate="no">.adds/koreader/plugins</code> on a Kobo,{" "}
          <code translate="no">koreader/plugins</code> on a Kindle,{" "}
          <code translate="no">applications/koreader/plugins</code> on a
          PocketBook, <code translate="no">koreader/plugins</code> on Android.
        </li>
        <li>Restart KOReader.</li>
        <li>
          Open <b>Tools › Omnibus › Sync now</b>, in the file browser or the
          reader.
        </li>
        <li>
          No plugin? Tick <b>Connect without the plugin</b> before adding, then
          log in under <b>Progress sync › Custom sync server</b> with the login
          it shows.
        </li>
      </ol>
      <p className="subtitle kobo-shelf-rule" data-testid="koreader-shelf-rule">
        Only shelves marked <b>Sync to my devices</b> are synced, so set that on
        a shelf before the first sync.{" "}
        <Link to="/shelves" data-testid="koreader-shelves-link">
          Choose shelves to sync
        </Link>
      </p>
    </details>
  );
}

/** The checkbox that makes the next add a no-plugin KOReader, with the line saying what that means. */
function NoPluginOption({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="device-add-option">
      <label className="device-add-check" htmlFor="koreader-no-plugin">
        <input
          type="checkbox"
          id="koreader-no-plugin"
          data-testid="koreader-no-plugin"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>Connect without the plugin (Progress sync only)</span>
      </label>
      <p className="subtitle device-add-hint">
        For a KOReader you’d rather not install the plugin on. It uses
        KOReader’s built-in Progress sync, which keeps only your place in step:
        no shelves, no highlights.
      </p>
    </div>
  );
}

/** One revealed value: a label, a read-only field and a copy button, its id carrying the device's so two rows never share one. */
function LoginField({
  deviceId,
  deviceName,
  field,
  label,
  value,
}: {
  deviceId: number;
  deviceName: string;
  field: "url" | "username" | "password";
  label: string;
  value: string;
}) {
  const id = `kosync-${field}-${deviceId}`;
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <div className="kobo-endpoint-row">
        <input
          type="text"
          id={id}
          className="kobo-endpoint-url"
          data-testid={`kosync-${field}`}
          translate="no"
          spellCheck={false}
          readOnly
          value={value}
        />
        <CopyButton
          text={value}
          label="Copy"
          testId={`kosync-${field}-copy`}
          ariaLabel={`Copy the ${label.toLowerCase()} for ${deviceName}`}
        />
      </div>
    </div>
  );
}

type Sync = {
  panel: Panel | undefined;
  /** A new password was generated here since the page loaded, so every no-plugin KOReader must log in again. */
  signedOut: boolean;
  username: string;
  /** The earliest other no-plugin KOReader, which a reuse panel names as where the login was shown. */
  firstOther: string | undefined;
  /** Every no-plugin KOReader's name, as a sentence fragment. */
  allNames: string;
};

/** A no-plugin row's body: the login it just showed, the login it reuses, or a steady line. */
function ProgressSync({
  device,
  sync,
}: {
  device: KoboDeviceView;
  sync: Sync;
}) {
  const serverUrl = `${window.location.origin}/kosync`;
  const { panel } = sync;
  const field = (
    key: "url" | "username" | "password",
    label: string,
    value: string,
  ) => (
    <LoginField
      deviceId={device.id}
      deviceName={device.name}
      field={key}
      label={label}
      value={value}
    />
  );
  if (!panel)
    return (
      <p className="subtitle">
        Syncs your place through KOReader’s Progress sync.
      </p>
    );
  if (panel.kind === "reuse") {
    const who = sync.firstOther ?? "your other Progress sync devices";
    const when = sync.firstOther
      ? "when that device was added"
      : "when it was generated";
    return (
      <div className="kosync-login" data-testid="koreader-login-panel">
        <p className="kosync-login-title">
          Uses your existing Progress sync login
        </p>
        <p className="subtitle">
          Log in on this KOReader with the same server URL, username and
          password as {who}. The password was shown once, {when}.
        </p>
        {field("url", "Server URL", serverUrl)}
        {field("username", "Username", sync.username)}
        <p className="subtitle">
          A new password signs out every no-plugin KOReader until you log in
          again.
        </p>
      </div>
    );
  }
  const regenerated = panel.kind === "regenerated";
  return (
    <div className="kosync-login" data-testid="koreader-login-panel">
      <p className="kosync-login-title">
        {regenerated
          ? "New Progress sync login (shown once)"
          : "Progress sync login (shown once)"}
      </p>
      {field("url", "Server URL", serverUrl)}
      {field("username", "Username", panel.login.username)}
      {field("password", "Password", panel.login.password)}
      <p className="subtitle">
        {regenerated
          ? `Log in again on every no-plugin KOReader (here, ${sync.allNames}): Progress sync › Custom sync server › Login.`
          : "In KOReader: Progress sync › Custom sync server, then Login with these. Every no-plugin KOReader shares this one login. Only books downloaded from Omnibus match."}
      </p>
    </div>
  );
}

/** A plugin row's sync line: when it was added, or its last sync and any failure. */
function PluginState({ device }: { device: KoboDeviceView }) {
  return (
    <>
      <p className="subtitle" data-testid="koreader-last-sync">
        {device.last_sync_at
          ? `Last sync ${formatUtcDay(device.last_sync_at)}`
          : addedLabel(device.created_at, nowSecs())}
      </p>
      {device.last_sync_error && (
        <>
          <p
            className="settings-status error"
            data-testid="koreader-last-error"
          >
            Last sync failed: {device.last_sync_error}
          </p>
          <p className="subtitle">
            Redownload the plugin and replace the old copy on the device, then
            sync again.
          </p>
        </>
      )}
    </>
  );
}

type RowProps = {
  device: KoboDeviceView;
  canDownload: boolean;
  disabled: boolean;
  sync: Sync;
  onRemove: (device: KoboDeviceView) => void;
  onGenerate: (device: KoboDeviceView) => void;
};

/** One KOReader: its name and state, then what that kind does (a plugin download, or the Progress sync login), and Remove, which asks first. */
function DeviceRow({
  device,
  canDownload,
  disabled,
  sync,
  onRemove,
  onGenerate,
}: RowProps) {
  const noPlugin = device.kind === "kosync";
  const synced = device.last_sync_at != null;
  return (
    <li className="kobo-device-row" data-testid="koreader-device-row">
      <div className="kobo-device-head">
        <div className="kobo-device-title">
          <span className="kobo-device-name">{device.name}</span>
          {noPlugin && (
            <span className="users-badge" data-testid="koreader-device-badge">
              No plugin
            </span>
          )}
          {!noPlugin && !synced && (
            <span className="users-badge" data-testid="koreader-device-badge">
              Not synced yet
            </span>
          )}
        </div>
        {noPlugin &&
          (sync.signedOut ? (
            <span
              className="kobo-row-status error"
              data-testid="koreader-signed-out"
            >
              Signed out · log in again
            </span>
          ) : (
            <span className="kobo-row-status">Progress sync</span>
          ))}
      </div>
      {noPlugin ? (
        <ProgressSync device={device} sync={sync} />
      ) : (
        <PluginState device={device} />
      )}
      <div className="settings-actions">
        {noPlugin ? (
          <Button
            variant="ghost"
            disabled={disabled}
            aria-label={`Generate a new password for ${device.name}`}
            data-testid="kosync-generate"
            onClick={() => onGenerate(device)}
          >
            Generate a new password
          </Button>
        ) : (
          canDownload && (
            <a
              className={classes("btn", !synced && "primary")}
              href={pluginUrl(device.id)}
              download={`omnibus-koreader-${device.id}.zip`}
              aria-label={`Download the plugin for ${device.name}`}
              data-testid="koreader-plugin-download"
            >
              {synced ? "Redownload plugin" : "Download plugin"}
            </a>
          )
        )}
        <Button
          variant="danger"
          disabled={disabled}
          aria-label={`Remove ${device.name}`}
          data-testid="koreader-device-remove"
          onClick={() => onRemove(device)}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

/** The reader's KOReaders, with the plugin or without it: add one, download its plugin or use the account's Progress sync login, remove it. */
export function KoreaderCard() {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const devices = useQuery(koboDevicesQuery);
  // The list also holds Kobos, which the Kobo card shows.
  const koreaders = devices.data?.filter(isKoreader);
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [noPlugin, setNoPlugin] = useState(false);
  const [panels, setPanels] = useState<{ id: number; panel: Panel }[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  // Decided when the list first answers: adding the first KOReader must not fold the steps away mid-read.
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  if (setupOpen === null && koreaders) {
    setSetupOpen(koreaders.length === 0);
  }
  const form = useNameForm();

  // A read still in flight would land over the patch, so it is dropped first; only a list that has answered is patched.
  const setList = async (
    change: (list: KoboDeviceView[]) => KoboDeviceView[],
  ) => {
    await queryClient.cancelQueries({ queryKey: koboDevicesQuery.queryKey });
    queryClient.setQueryData(
      koboDevicesQuery.queryKey,
      (list) => list && change(list),
    );
  };
  const report = (message: string, error = false) =>
    setStatus({ message, error });
  // After a refusal the list is re-read, so it shows what the server holds (a 404 means the device is gone).
  const refused = (error: Error) => {
    report(error.message, true);
    void queryClient.invalidateQueries({ queryKey: koboDevicesQuery.queryKey });
  };
  const add = useMutation({
    mutationFn: ({ name, kind }: { name: string; kind: DeviceKind }) =>
      createKoboDevice(name, kind),
    onMutate: () => setStatus(null),
    onSuccess: async (device) => {
      form.reset();
      setNoPlugin(false);
      if (device.kind === "kosync") {
        const panel: Panel = device.kosync_login
          ? { kind: "fresh", login: device.kosync_login }
          : { kind: "reuse" };
        if (device.kosync_login) setSignedOut(false);
        setPanels((all) => [...all, { id: device.id, panel }]);
      }
      await setList((list) => [...list, device]);
      report(addedMessage(device));
    },
    onError: (error) => report(error.message, true),
    // Not awaited: the form is free again while the list is read.
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: koboDevicesQuery.queryKey,
      });
    },
  });
  const remove = useMutation({
    mutationFn: deleteKoboDevice,
    onMutate: () => setStatus(null),
    onSuccess: async (_, id) => {
      await setList((list) => list.filter((d) => d.id !== id));
      setPanels((all) => all.filter((p) => p.id !== id));
      if (!koreaders?.some((d) => d.kind === "kosync" && d.id !== id))
        setSignedOut(false);
      report("KOReader removed.");
    },
    onError: refused,
    onSettled: () => setPending(null),
  });
  const generate = useMutation({
    mutationFn: (_row: number) => generateKosyncPassword(),
    onMutate: () => setStatus(null),
    onSuccess: (login, row) => {
      // The old password is dead, so no earlier panel may still claim to show it.
      setPanels([{ id: row, panel: { kind: "regenerated", login } }]);
      setSignedOut(true);
      report("New password generated. Copy it now: it is shown once.");
    },
    onError: (error) => report(error.message, true),
    onSettled: () => setPending(null),
  });
  const busy = add.isPending || remove.isPending || generate.isPending;

  const shown = statusOrLoadError(
    status,
    devices.error,
    "Couldn’t load your KOReaders: ",
  );
  const allNames = joinNames(noPluginNames(koreaders ?? []));
  const syncFor = (device: KoboDeviceView): Sync => ({
    panel: panels.find((p) => p.id === device.id)?.panel,
    signedOut,
    username: user.username,
    firstOther: koreaders?.find(
      (d) => d.kind === "kosync" && d.id !== device.id,
    )?.name,
    allNames,
  });
  const askRemove = (device: KoboDeviceView) => {
    const others = koreaders?.filter((d) => d.id !== device.id) ?? [];
    setPending({
      action: "remove",
      device,
      lastNoPlugin:
        device.kind === "kosync" && !others.some((d) => d.kind === "kosync"),
    });
  };
  const askGenerate = (device: KoboDeviceView) =>
    setPending({
      action: "generate",
      id: device.id,
      names: noPluginNames(koreaders ?? []),
    });

  const dialog =
    pending?.action === "remove"
      ? {
          testId: "koreader-remove-dialog",
          ...removeConfirmText(pending.device.name, pending.lastNoPlugin),
          action: "Remove device",
          busyLabel: "Removing…",
          onConfirm: () => remove.mutate(pending.device.id),
        }
      : pending && {
          testId: "kosync-replace-dialog",
          ...generateConfirmText(pending.names),
          action: "Generate new password",
          busyLabel: "Generating…",
          onConfirm: () => generate.mutate(pending.id),
        };
  return (
    <section className="card" data-testid="koreader-devices-card">
      <h3>KOReader</h3>
      <p className="subtitle">
        Sync your shelves, reading position and highlights to KOReader with the
        Omnibus plugin, on any device that runs KOReader.
      </p>
      <Setup open={setupOpen ?? false} />
      <DeviceAddForm
        prefix="koreader"
        placeholder="e.g. Kobo Libra (KOReader)…"
        label="Add a KOReader"
        form={form}
        busy={busy}
        adding={add.isPending}
        onAdd={(name) =>
          add.mutate({ name, kind: noPlugin ? "kosync" : "koreader" })
        }
        onRefuse={(message) => report(message, true)}
        onEdit={() => setStatus(null)}
        extra={
          <NoPluginOption
            checked={noPlugin}
            disabled={busy}
            onChange={setNoPlugin}
          />
        }
        status={
          <StatusLine testId="koreader-devices-status" status={shown} action />
        }
      />
      {devices.isPending && (
        <div
          role="status"
          aria-live="polite"
          data-testid="koreader-devices-loading"
        >
          <span className="ld-sr">Finding your KOReaders</span>
          <RowSkeletons count={1} avatar={false} />
        </div>
      )}
      {koreaders?.length === 0 && (
        <p className="settings-status" data-testid="koreader-devices-empty">
          No KOReader registered yet.
        </p>
      )}
      {koreaders && koreaders.length > 0 && (
        <ul className="kobo-device-list" data-testid="koreader-device-list">
          {koreaders.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              canDownload={user.canDownload}
              disabled={busy}
              sync={syncFor(device)}
              onRemove={askRemove}
              onGenerate={askGenerate}
            />
          ))}
        </ul>
      )}
      {dialog && (
        <ConfirmDialog
          testId={dialog.testId}
          title={dialog.title}
          body={dialog.body}
          action={dialog.action}
          busyLabel={dialog.busyLabel}
          busy={remove.isPending || generate.isPending}
          onCancel={() => setPending(null)}
          onConfirm={dialog.onConfirm}
        />
      )}
    </section>
  );
}
