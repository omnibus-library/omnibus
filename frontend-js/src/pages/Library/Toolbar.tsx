import { Link } from "react-router";
import { SortKey } from "../../api";
import { ArrowDownGlyph, ArrowUpGlyph } from "../../components/Glyphs/Glyphs";
import { useCurrentUser, useUserSwitch } from "../../session";
import type { Prefs } from "../../viewPrefs";
import { hiddenFormatsLabel } from "./libraryView";
import { headerSort, SORT_KEYS, sortLabel, toggleDir } from "./sorting";

type ToolbarProps = {
  prefs: Prefs;
  /** The formats the reader's preference keeps off this list. */
  hiddenFormats: string[];
  /** Why sorting is inert on this list, or `null` when it acts. */
  sortLock: string | null;
  /** Whether this list stacks series; a shelf never does, so the switch is hidden there. */
  stackable: boolean;
  onChange: (next: Prefs) => void;
};

/** The view toggle, in grid view the sort controls, and the hidden-formats note. */
export function Toolbar({
  prefs,
  hiddenFormats,
  sortLock,
  stackable,
  onChange,
}: ToolbarProps) {
  const user = useCurrentUser();
  const stack = useUserSwitch("stackSeries");
  const hidden = hiddenFormatsLabel(hiddenFormats);
  return (
    <div className="lib-toolbar" role="toolbar">
      {prefs.view === "grid" && stackable && (
        <>
          <button
            type="button"
            className={user.stackSeries ? "ss-tog on" : "ss-tog"}
            aria-pressed={user.stackSeries}
            // aria-disabled, not disabled: a control that disables itself drops the keyboard's focus.
            aria-disabled={stack.isPending}
            onClick={
              stack.isPending
                ? undefined
                : () => stack.mutate(!user.stackSeries)
            }
          >
            <span className="ss-sw" aria-hidden="true" />
            Stack series
          </button>
          {stack.isError && (
            <span className="ss-terr" role="alert">
              Couldn't save Stack series. Try again.
            </span>
          )}
        </>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width that .lib-view-toggle never resets */}
      <div className="lib-view-toggle" role="group" aria-label="View mode">
        {(["table", "grid"] as const).map((view) => (
          <button
            key={view}
            type="button"
            className="lib-toggle-btn"
            aria-pressed={prefs.view === view}
            onClick={() => onChange({ ...prefs, view })}
          >
            {view === "table" ? "Table" : "Grid"}
          </button>
        ))}
      </div>
      {prefs.view === "grid" && (
        <div className="lib-sort-controls">
          <label className="lib-sort-label">
            Sort by
            <select
              className="lib-sort-select"
              disabled={sortLock !== null}
              value={prefs.sort}
              onChange={(e) =>
                onChange({
                  ...prefs,
                  ...headerSort(prefs, SortKey.parse(e.target.value)),
                })
              }
            >
              {SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {sortLabel(key)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="lib-sort-dir"
            disabled={sortLock !== null}
            aria-label={`Sort direction: ${prefs.dir === "asc" ? "ascending" : "descending"}`}
            onClick={() => onChange({ ...prefs, dir: toggleDir(prefs.dir) })}
          >
            {prefs.dir === "asc" ? <ArrowUpGlyph /> : <ArrowDownGlyph />}
          </button>
        </div>
      )}
      {sortLock && (
        // Outside the grid block: in table view the headers are the inert control.
        <span className="label lib-sort-locked">{sortLock}</span>
      )}
      {hidden && (
        // The note links to the preference, so a missing book never reads as a missing file.
        <Link className="lib-hidden-formats" to="/settings?section=preferences">
          {hidden}
          <span className="sr-only">. Change in Settings</span>
        </Link>
      )}
    </div>
  );
}
