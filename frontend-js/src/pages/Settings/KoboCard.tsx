import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import {
  createKoboDevice,
  deleteKoboDevice,
  type KoboDeviceView,
  koboDevicesQuery,
  regenerateKoboDevice,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { CopyButton } from "../../components/CopyButton/CopyButton";
import { BusyLabel, RowSkeletons } from "../../components/Loading/Loading";
import {
  External,
  type Status,
  StatusLine,
} from "../../components/SettingsShell/SettingsShell";

const NameSchema = z.object({
  name: z.string().trim().min(1, "Enter a name for your Kobo."),
});

const KOBO_BACKUP_URL = "https://github.com/omnibus-library/kobo-backup";

/** The unconditional first-sync data-loss warning: the hazard applies the moment a URL is copied. */
function Warning() {
  return (
    <div className="kobo-warning" data-testid="kobo-data-loss-warning">
      <p className="kobo-warning-title">
        First sync can erase your Kobo’s highlights
      </p>
      <p>
        An improper sync can potentially wipe data on the Kobo like your
        annotations, notes, bookmarks, reading progress, and books.
      </p>
      <p>
        It is highly recommended to back up your device before attempting a sync
        with one of these tools:
      </p>
      <ul className="kobo-warning-tools">
        <li>
          <External href={KOBO_BACKUP_URL}>
            omnibus-library/kobo-backup
          </External>
          , whose TUI also sets your Kobo’s sync URL for you
        </li>
        <li>
          <External href="https://github.com/karlicoss/kobuddy#usage">
            karlicoss/kobuddy
          </External>
        </li>
      </ul>
      <p>
        At minimum, copy <code translate="no">.kobo/KoboReader.sqlite</code> off
        the device over USB.
      </p>
    </div>
  );
}

/** How to connect a Kobo, open by default only for a reader with none yet. */
function Setup({ open }: { open: boolean }) {
  return (
    <details className="kobo-setup" data-testid="kobo-setup" open={open}>
      <summary className="kobo-setup-summary">How to connect a Kobo</summary>
      <ol className="subtitle kobo-setup-steps" data-testid="kobo-setup-steps">
        <li>
          Give your Kobo a name and click <b>Add device</b> below.
        </li>
        <li>
          Copy the whole <b>Wireless sync endpoint</b> URL shown for it. It must
          be reachable from the Kobo’s own Wi-Fi.
        </li>
        <li>Connect the Kobo over USB and tap Connect on the device.</li>
        <li>
          Edit <code translate="no">.kobo/Kobo/Kobo eReader.conf</code> and set{" "}
          <code translate="no">api_endpoint=</code> under{" "}
          <code translate="no">[OneStoreServices]</code> to the URL you copied,
          or let the{" "}
          <External href={KOBO_BACKUP_URL}>
            omnibus-library/kobo-backup
          </External>{" "}
          TUI set it for you.
        </li>
        <li>Eject safely. Your next sync on the device talks to Omnibus.</li>
      </ol>
      <p className="subtitle kobo-shelf-rule" data-testid="kobo-shelf-rule">
        Only shelves marked <b>Sync to Kobo</b> are synced, so set that on a
        shelf before the first sync.{" "}
        <Link to="/shelves" data-testid="kobo-shelves-link">
          Choose shelves to sync
        </Link>
      </p>
    </details>
  );
}

type Pending = { action: "regenerate" | "remove"; device: KoboDeviceView };

const CONFIRM = {
  regenerate: {
    testId: "kobo-regenerate-dialog",
    action: "Regenerate token",
    busyLabel: "Regenerating…",
    title: (name: string) => `Regenerate the token for ${name}?`,
    body: (name: string) =>
      `${name} stops syncing until you replace its api_endpoint with the new URL over USB.`,
  },
  remove: {
    testId: "kobo-remove-dialog",
    action: "Remove device",
    busyLabel: "Removing…",
    title: (name: string) => `Remove ${name}?`,
    body: (name: string) =>
      `${name} stops syncing with Omnibus. To sync it again, add it as a new device.`,
  },
};

type RowProps = {
  device: KoboDeviceView;
  disabled: boolean;
  onAsk: (pending: Pending) => void;
};

/** One Kobo: its label, the endpoint URL to copy, and Regenerate and Remove, which ask first. */
function DeviceRow({ device, disabled, onAsk }: RowProps) {
  const endpoint = `${window.location.origin}/kobo/${device.token}`;
  const id = `kobo-endpoint-${device.id}`;
  return (
    <li className="kobo-device-row" data-testid="kobo-device-row">
      <div className="kobo-device-head">
        <span className="kobo-device-name">{device.name}</span>
      </div>
      <div className="settings-field">
        <label htmlFor={id}>Wireless sync endpoint</label>
        <div className="kobo-endpoint-row">
          <input
            type="text"
            id={id}
            className="kobo-endpoint-url"
            data-testid="kobo-endpoint-url"
            translate="no"
            spellCheck={false}
            readOnly
            value={endpoint}
          />
          <CopyButton
            text={endpoint}
            label="Copy URL"
            testId="kobo-endpoint-copy"
            ariaLabel={`Copy the endpoint URL for ${device.name}`}
          />
        </div>
      </div>
      <div className="settings-actions">
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={`Regenerate token for ${device.name}`}
          data-testid="kobo-device-regenerate"
          onClick={() => onAsk({ action: "regenerate", device })}
        >
          Regenerate
        </Button>
        <Button
          variant="ghost"
          className="danger"
          disabled={disabled}
          aria-label={`Remove ${device.name}`}
          data-testid="kobo-device-remove"
          onClick={() => onAsk({ action: "remove", device })}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

/** The reader's Kobos: add one, copy its sync address, regenerate that address or remove the device. */
export function KoboCard() {
  const queryClient = useQueryClient();
  const devices = useQuery(koboDevicesQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Decided when the list first answers: adding the first Kobo must not fold the steps away mid-read.
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  if (setupOpen === null && devices.data) {
    setSetupOpen(devices.data.length === 0);
  }
  const form = useForm({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: "" },
  });

  // Only a list that has answered is patched; the reread after a create fills the rest.
  const setList = (change: (list: KoboDeviceView[]) => KoboDeviceView[]) =>
    queryClient.setQueryData(
      koboDevicesQuery.queryKey,
      (list) => list && change(list),
    );
  const report = (message: string, error = false) =>
    setStatus({ message, error });
  // After a refusal the list is re-read, so it shows what the server holds (a 404 means the device is gone).
  const refused = (error: Error) => {
    report(error.message, true);
    void queryClient.invalidateQueries({ queryKey: koboDevicesQuery.queryKey });
  };
  const add = useMutation({
    mutationFn: createKoboDevice,
    onMutate: async () => {
      setStatus(null);
      // A list read still in flight would land over the new row.
      await queryClient.cancelQueries({ queryKey: koboDevicesQuery.queryKey });
    },
    onSuccess: (device) => {
      form.reset();
      setList((list) => [...list, device]);
      report("Kobo added. Copy its endpoint URL below.");
    },
    onError: (error) => report(error.message, true),
    // Not awaited: the form is free again while the list is read.
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: koboDevicesQuery.queryKey,
      });
    },
  });
  const regenerate = useMutation({
    mutationFn: regenerateKoboDevice,
    onMutate: () => setStatus(null),
    onSuccess: (device) => {
      setList((list) => list.map((d) => (d.id === device.id ? device : d)));
      report("Token regenerated. Update the URL on your Kobo.");
    },
    onError: refused,
    onSettled: () => setPending(null),
  });
  const remove = useMutation({
    mutationFn: deleteKoboDevice,
    onMutate: () => setStatus(null),
    onSuccess: (_, id) => {
      setList((list) => list.filter((d) => d.id !== id));
      report("Kobo removed.");
    },
    onError: refused,
    onSettled: () => setPending(null),
  });
  const busy = add.isPending || regenerate.isPending || remove.isPending;

  const confirm = pending && CONFIRM[pending.action];
  const shown =
    status ??
    (devices.isError
      ? {
          message: `Couldn’t load your Kobos: ${devices.error.message}`,
          error: true,
        }
      : null);
  return (
    <section className="card" data-testid="kobo-devices-card">
      <h3>Kobo wireless sync</h3>
      <p className="subtitle">Sync your shelves to a Kobo over Wi-Fi.</p>
      <Warning />
      <Setup open={setupOpen ?? false} />
      <form
        id="kobo-add-form"
        className="settings-form"
        onSubmit={form.handleSubmit(
          ({ name }) => add.mutate(name),
          (errors) => report(errors.name?.message ?? "", true),
        )}
      >
        <div className="settings-field">
          <label htmlFor="kobo-device-name">Device name</label>
          <input
            type="text"
            id="kobo-device-name"
            data-testid="kobo-device-name-input"
            autoComplete="off"
            placeholder="e.g. Kobo Clara…"
            maxLength={100}
            {...form.register("name", { onChange: () => setStatus(null) })}
          />
        </div>
        <div className="settings-actions">
          <StatusLine testId="kobo-devices-status" status={shown} action />
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            aria-busy={add.isPending}
            data-testid="kobo-device-add"
          >
            <BusyLabel
              busy={add.isPending}
              label="Add device"
              busyLabel="Adding…"
            />
          </Button>
        </div>
      </form>
      {devices.isPending && (
        <div
          role="status"
          aria-live="polite"
          data-testid="kobo-devices-loading"
        >
          <span className="ld-sr">Finding your Kobos</span>
          <RowSkeletons count={1} avatar={false} />
        </div>
      )}
      {devices.data?.length === 0 && (
        <p className="settings-status" data-testid="kobo-devices-empty">
          No Kobo registered yet.
        </p>
      )}
      {devices.data && devices.data.length > 0 && (
        <ul className="kobo-device-list" data-testid="kobo-device-list">
          {devices.data.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              disabled={busy}
              onAsk={setPending}
            />
          ))}
        </ul>
      )}
      {pending && confirm && (
        <ConfirmDialog
          testId={confirm.testId}
          title={confirm.title(pending.device.name)}
          body={confirm.body(pending.device.name)}
          action={confirm.action}
          busyLabel={confirm.busyLabel}
          busy={regenerate.isPending || remove.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            (pending.action === "regenerate" ? regenerate : remove).mutate(
              pending.device.id,
            )
          }
        />
      )}
    </section>
  );
}
