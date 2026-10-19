import { SortKey } from "../../api";
import { ArrowDownGlyph, ArrowUpGlyph } from "../../components/Glyphs/Glyphs";
import type { Prefs } from "../../viewPrefs";
import { defaultDirFor, SORT_KEYS, sortLabel, toggleDir } from "./sorting";

type ToolbarProps = { prefs: Prefs; onChange: (next: Prefs) => void };

/** The view toggle and, in grid view, the sort controls. */
export function Toolbar({ prefs, onChange }: ToolbarProps) {
  const pick = (sort: SortKey) =>
    // A different axis adopts its natural direction, as the table's headers do.
    onChange({
      ...prefs,
      sort,
      dir: sort === prefs.sort ? prefs.dir : defaultDirFor(sort),
    });
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
              onChange={(e) => pick(SortKey.parse(e.target.value))}
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
    </div>
  );
}
