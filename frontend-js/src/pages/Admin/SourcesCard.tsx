import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  type LibrarySection,
  libraryContentsQuery,
  saveSettings,
  settingsQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { useUnsavedForm } from "../../components/SettingsShell/SettingsShell";
import { LiveStatus } from "./StatusLine";
import {
  librarySummaryLine,
  SCAN_INTERVAL_MIN_HOURS,
  sourcesPayload,
} from "./sources";

type Fields = { ebook: string; audiobook: string; interval: string };

type Status = { text: string; isError: boolean };

const BLANK: Fields = { ebook: "", audiobook: "", interval: "" };

const NOT_LOADED =
  "The saved settings haven’t loaded, so saving now would clear them.";
const INTERVAL_MESSAGE = "Enter a whole number of hours, or leave it blank.";

function LibrarySummary({
  testId,
  section,
}: {
  testId: string;
  section: LibrarySection | undefined;
}) {
  if (!section?.path) {
    return (
      <p id={testId} data-testid={testId} className="library-summary empty" />
    );
  }
  if (section.error) {
    return (
      <p id={testId} data-testid={testId} className="library-summary error">
        Couldn’t read this folder: {section.error}
      </p>
    );
  }
  return (
    <p id={testId} data-testid={testId} className="library-summary">
      {librarySummaryLine(section)}
    </p>
  );
}

/** The library folders and rescan interval, with what the scanner finds in each folder. */
export function SourcesCard() {
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery);
  const library = useQuery(libraryContentsQuery);
  const [fields, setFields] = useState(BLANK);
  // What the server holds, as the form last showed it; null until the settings load.
  const [saved, setSaved] = useState<Fields | null>(null);
  const [intervalInvalid, setIntervalInvalid] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  if (settings.data && saved === null) {
    const loaded = {
      ebook: settings.data.ebook_library_path ?? "",
      audiobook: settings.data.audiobook_library_path ?? "",
      interval: settings.data.scan_interval_hours?.toString() ?? "",
    };
    setSaved(loaded);
    setFields(loaded);
  }
  useUnsavedForm(
    "library-sources",
    saved !== null &&
      (saved.ebook !== fields.ebook ||
        saved.audiobook !== fields.audiobook ||
        saved.interval !== fields.interval),
  );

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: (answer) => {
      queryClient.setQueryData(settingsQuery.queryKey, answer);
      void queryClient.invalidateQueries({
        queryKey: libraryContentsQuery.queryKey,
      });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    setIntervalInvalid(false);
    const payload = sourcesPayload(
      saved !== null,
      fields.ebook,
      fields.audiobook,
      fields.interval,
    );
    if (payload.refused === "not-loaded") {
      setStatus({ text: NOT_LOADED, isError: true });
      return;
    }
    if (payload.refused === "bad-interval") {
      setIntervalInvalid(true);
      return;
    }
    setStatus(null);
    const submitted = fields;
    save.mutate(payload.settings, {
      onSuccess: () => {
        setSaved(submitted);
        setStatus({ text: "Library settings saved.", isError: false });
      },
      onError: (error) =>
        setStatus({
          text: `Couldn’t save the library settings: ${error.message}`,
          isError: true,
        }),
    });
  };

  const edit = (field: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [field]: value }));

  const shown: Status | null =
    status ??
    (settings.isError
      ? {
          text: `Couldn’t load the saved settings: ${settings.error.message}`,
          isError: true,
        }
      : null);

  return (
    <section className="card" data-testid="library-location-card">
      <h3>Library folders</h3>
      <p className="subtitle">
        Where your books live on disk, and how often Omnibus rescans them.
      </p>
      <form
        id="settings-form"
        className="settings-form"
        noValidate
        onSubmit={submit}
      >
        <div className="settings-field">
          <label htmlFor="ebook-library-path">Ebook library path</label>
          <input
            type="text"
            id="ebook-library-path"
            name="ebook_library_path"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            value={fields.ebook}
            placeholder="/path/to/ebooks…"
            onChange={(e) => edit("ebook")(e.target.value)}
          />
          <LibrarySummary
            testId="ebook-library-summary"
            section={library.data?.ebooks}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="audiobook-library-path">Audiobook library path</label>
          <input
            type="text"
            id="audiobook-library-path"
            name="audiobook_library_path"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            value={fields.audiobook}
            placeholder="/path/to/audiobooks…"
            onChange={(e) => edit("audiobook")(e.target.value)}
          />
          <LibrarySummary
            testId="audiobook-library-summary"
            section={library.data?.audiobooks}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="scan-interval-hours">
            Automatic rescan interval (hours)
          </label>
          <input
            type="number"
            min={SCAN_INTERVAL_MIN_HOURS}
            inputMode="numeric"
            id="scan-interval-hours"
            name="scan_interval_hours"
            data-testid="scan-interval-hours"
            aria-describedby="scan-interval-hint"
            aria-invalid={intervalInvalid}
            value={fields.interval}
            onChange={(e) => edit("interval")(e.target.value)}
          />
          <p className="settings-hint" id="scan-interval-hint">
            Leave blank to rescan only when you ask.
          </p>
          {intervalInvalid && (
            <p
              className="settings-status error"
              role="alert"
              data-testid="scan-interval-error"
            >
              {INTERVAL_MESSAGE}
            </p>
          )}
        </div>
        <div className="settings-actions">
          {settings.isError && (
            <Button
              variant="ghost"
              data-testid="library-retry"
              onClick={() => settings.refetch()}
            >
              Try again
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            data-testid="library-save"
            disabled={saved === null || save.isPending}
            aria-busy={save.isPending}
          >
            <BusyLabel
              busy={save.isPending}
              label="Save library settings"
              busyLabel="Saving…"
            />
          </Button>
        </div>
      </form>
      <LiveStatus
        testId="settings-status"
        message={shown?.text ?? null}
        isError={shown?.isError ?? false}
      />
    </section>
  );
}
