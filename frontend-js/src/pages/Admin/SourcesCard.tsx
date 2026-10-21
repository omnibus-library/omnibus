import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  type LibrarySection,
  libraryContentsQuery,
  replaceQueryData,
  type Settings,
  saveSettings,
  settingsQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  heldTrimmed,
  type Status,
  StatusLine,
  statusOrLoadError,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import {
  INTERVAL_MESSAGE,
  librarySummaryLine,
  SCAN_INTERVAL_MIN_HOURS,
  SourcesSchema,
} from "./sources";

const BLANK = {
  ebook_library_path: "",
  audiobook_library_path: "",
  scan_interval_hours: "",
};

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

const toFields = (settings: Settings): z.input<typeof SourcesSchema> => ({
  ebook_library_path: settings.ebook_library_path ?? "",
  audiobook_library_path: settings.audiobook_library_path ?? "",
  scan_interval_hours: settings.scan_interval_hours?.toString() ?? "",
});

/** The library folders and rescan interval, with what the scanner finds in each folder. */
export function SourcesCard() {
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery);
  const library = useQuery(libraryContentsQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const intervalInput = useRef<HTMLInputElement>(null);
  const form = useForm({
    resolver: zodResolver(SourcesSchema),
    defaultValues: BLANK,
    // The form shows cached settings at once and takes each later read, but never over a typed edit.
    values: settings.data ? toFields(settings.data) : undefined,
    resetOptions: { keepDirtyValues: true },
    // A refused interval stays marked until the next submit.
    reValidateMode: "onSubmit",
    shouldFocusError: false,
  });
  useUnsavedGuard("library-sources", form.formState.isDirty);

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: async (answer) => {
      await replaceQueryData(queryClient, settingsQuery.queryKey, answer);
      void queryClient.invalidateQueries({
        queryKey: libraryContentsQuery.queryKey,
      });
      // Each library's source order is the default one until its folder is set.
      void queryClient.invalidateQueries({
        queryKey: ["admin", "metadata-order"],
      });
    },
  });

  const submit = form.handleSubmit((update) => {
    // A number field reads half-typed text as blank, which would save as "no interval".
    if (intervalInput.current?.validity.badInput) {
      form.setError("scan_interval_hours", { message: INTERVAL_MESSAGE });
      return;
    }
    // Save writes every field, so it waits for the loaded settings: blanks saved over a failed read would clear both paths.
    if (settings.data === undefined) return;
    setStatus(null);
    save.mutate(update, {
      onSuccess: () =>
        setStatus({ message: "Library settings saved.", error: false }),
      onError: (error) =>
        setStatus({
          message: `Couldn’t save the library settings: ${error.message}`,
          error: true,
        }),
    });
  });
  const interval = form.register("scan_interval_hours", heldTrimmed);
  const intervalError = form.formState.errors.scan_interval_hours;

  const loadFailed = settings.isError && settings.data === undefined;
  const shown = statusOrLoadError(
    status,
    loadFailed ? settings.error : null,
    "Couldn’t load the saved settings: ",
  );

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
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="/path/to/ebooks…"
            {...form.register("ebook_library_path", heldTrimmed)}
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
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            translate="no"
            placeholder="/path/to/audiobooks…"
            {...form.register("audiobook_library_path", heldTrimmed)}
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
            data-testid="scan-interval-hours"
            aria-describedby="scan-interval-hint"
            aria-invalid={intervalError !== undefined}
            {...interval}
            ref={(input) => {
              interval.ref(input);
              intervalInput.current = input;
            }}
          />
          <p className="settings-hint" id="scan-interval-hint">
            Leave blank to rescan only when you ask.
          </p>
          {intervalError && (
            <p
              className="settings-status error"
              role="alert"
              data-testid="scan-interval-error"
            >
              {intervalError.message}
            </p>
          )}
        </div>
        <div className="settings-actions">
          {loadFailed && (
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
            disabled={settings.data === undefined || save.isPending}
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
      <StatusLine testId="settings-status" status={shown} />
    </section>
  );
}
