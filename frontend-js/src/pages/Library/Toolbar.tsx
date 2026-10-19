import { Link } from "react-router";
import { SortKey } from "../../api";
import { ArrowDownGlyph, ArrowUpGlyph } from "../../components/Glyphs/Glyphs";
import type { Prefs } from "../../viewPrefs";
import { hiddenFormatsLabel } from "./libraryView";
import { headerSort, SORT_KEYS, sortLabel, toggleDir } from "./sorting";

type ToolbarProps = {
  prefs: Prefs;
  /** The formats the reader's preference keeps off this list. */
  hiddenFormats: string[];
  onChange: (next: Prefs) => void;
};

/** The view toggle, in grid view the sort controls, and the hidden-formats note. */
export function Toolbar({ prefs, hiddenFormats, onChange }: ToolbarProps) {
  const hidden = hiddenFormatsLabel(hiddenFormats);
  return (
    <div className="lib-toolbar" role="toolbar">
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
            aria-label={`Sort direction: ${prefs.dir === "asc" ? "ascending" : "descending"}`}
            onClick={() => onChange({ ...prefs, dir: toggleDir(prefs.dir) })}
          >
            {prefs.dir === "asc" ? <ArrowUpGlyph /> : <ArrowDownGlyph />}
          </button>
        </div>
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
