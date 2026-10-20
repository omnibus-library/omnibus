import type { ReactNode } from "react";
import { ThemePicker } from "../../components/ThemePicker/ThemePicker";
import {
  type UserSwitch,
  useCurrentUser,
  useHiddenFormats,
  useUserSwitch,
} from "../../session";
import { formatOptions, withFormat } from "./hiddenFormats";

type SettingRowProps = {
  label: string;
  description: string;
  controlId: string;
  testId?: string;
  children: ReactNode;
};

/** A setting's name and what it does on the left, its control on the right. */
function SettingRow({
  label,
  description,
  controlId,
  testId,
  children,
}: SettingRowProps) {
  return (
    <div className="setting-row" data-testid={testId}>
      <div className="setting-row-text">
        <label className="setting-row-label" htmlFor={controlId}>
          {label}
        </label>
        <p className="setting-row-desc" id={`${controlId}-desc`}>
          {description}
        </p>
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

/** The inline result beside an autosaving control: a live region mounted before the first save so that save is announced. */
function SaveStatus({
  testId,
  save,
}: {
  testId: string;
  save: {
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: Error | null;
  };
}) {
  const { isPending, isError, isSuccess, error } = save;
  let text = "";
  if (isPending) text = "Saving…";
  else if (isError) text = `Couldn’t save: ${error?.message}`;
  else if (isSuccess) text = "Saved";
  const className = isError
    ? "pref-status error"
    : isPending
      ? "pref-status ld-sheen"
      : "pref-status";
  return (
    <span role="status" className={className} data-testid={testId}>
      {text}
    </span>
  );
}

type SwitchRowProps = {
  setting: UserSwitch;
  slug: string;
  name: string;
  description: string;
};

function SwitchRow({ setting, slug, name, description }: SwitchRowProps) {
  const user = useCurrentUser();
  const save = useUserSwitch(setting);
  const id = `${slug}-toggle`;
  return (
    <SettingRow
      label={name}
      description={description}
      controlId={id}
      testId={`user-setting-${slug}`}
    >
      <div className="pref-control">
        <SaveStatus testId={`${slug}-status`} save={save} />
        <span className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            id={id}
            aria-describedby={`${id}-desc`}
            data-testid={id}
            checked={user[setting]}
            aria-checked={user[setting]}
            disabled={save.isPending}
            onChange={(event) => save.mutate(event.target.checked)}
          />
        </span>
      </div>
    </SettingRow>
  );
}

function HiddenFormats() {
  const { hiddenFormats } = useCurrentUser();
  const save = useHiddenFormats();
  return (
    <fieldset
      className="pref-fieldset"
      data-testid="account-hidden-formats-card"
      aria-describedby="hidden-formats-desc"
    >
      <legend className="setting-row-label">Hidden formats</legend>
      <p className="setting-row-desc" id="hidden-formats-desc">
        Hide these from your All Books view. A book stays visible while it has a
        format you haven’t hidden; other readers are unaffected.
      </p>
      <div className="hidden-formats-list">
        {formatOptions(hiddenFormats).map((fmt) => (
          <label
            key={fmt}
            className="hidden-format-row"
            htmlFor={`hidden-format-${fmt}`}
          >
            <input
              type="checkbox"
              id={`hidden-format-${fmt}`}
              data-testid={`hidden-format-toggle-${fmt}`}
              checked={hiddenFormats.includes(fmt)}
              disabled={save.isPending}
              onChange={(event) =>
                save.mutate(
                  withFormat(hiddenFormats, fmt, event.target.checked),
                )
              }
            />
            <span className="mono">{fmt.toUpperCase()}</span>
          </label>
        ))}
      </div>
      <SaveStatus testId="hidden-formats-status" save={save} />
    </fieldset>
  );
}

/** Theme (this device), then the library, book page and privacy preferences; each control saves the moment it changes. */
export function PreferencesSection() {
  return (
    <>
      <section className="card" data-testid="preferences-appearance">
        <h3>Appearance</h3>
        <SettingRow
          label="Theme"
          description="Applies to this device."
          controlId="theme-picker"
        >
          <ThemePicker id="theme-picker" describedBy="theme-picker-desc" />
        </SettingRow>
      </section>
      <section className="card" data-testid="preferences-library">
        <h3>Library</h3>
        <SwitchRow
          setting="stackSeries"
          slug="stack-series"
          name="Stack series"
          description="Fold each series into one stack in the library grid."
        />
        <HiddenFormats />
      </section>
      <section className="card" data-testid="preferences-book-page">
        <h3>Book page</h3>
        <SwitchRow
          setting="bookDetailScrollStops"
          slug="scroll-stops"
          name="Scroll stops"
          description="Snap a book’s page through one panel at a time instead of scrolling it."
        />
      </section>
      <section className="card" data-testid="preferences-privacy">
        <h3>Privacy</h3>
        <SwitchRow
          setting="shareStats"
          slug="share-stats"
          name="Share stats with household"
          description="Let other readers on this server see your Stats page. On by default."
        />
      </section>
    </>
  );
}
