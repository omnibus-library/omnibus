import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type FilterClause,
  type FilterField,
  type FilterMode,
  type NameCountField,
  type NamedCount,
  nameCountsQuery,
  shelvesQuery,
} from "../../api";
import { trapTab } from "../../focusTrap";
import { useCurrentUser } from "../../session";
import { Button } from "../Button/Button";
import { Loading } from "../Loading/Loading";
import {
  CLOUD_LIMIT,
  fieldLabel,
  fieldPlural,
  formatOptions,
  isPicked,
  MAX_FILTER_VALUES,
  MAX_SHOWN_OPTIONS,
  matching,
  namedOptions,
  noMatchLine,
  type OptionList,
  shelfOptions,
  statusLine,
  togglePick,
  withStranded,
} from "./filters";

// The tag and genre clouds stop at their most-used values; the lists don't.
function shapeNamed(field: NameCountField, rows: NamedCount[]): OptionList {
  const cloud = field === "tag" || field === "genre";
  return {
    options: namedOptions(rows),
    cap: cloud && rows.length >= CLOUD_LIMIT ? CLOUD_LIMIT : null,
  };
}

type Loaded =
  | { state: "loading" }
  | { state: "failed"; message: string; retry?: () => void }
  | { state: "ready"; list: OptionList };

/** Where the field's values stand: a fetch for shelves and names, a constant for formats. */
function useOptions(field: FilterField): Loaded {
  const viewerId = useCurrentUser().id;
  const shelves = useQuery(shelvesQuery);
  const named = field === "format" || field === "shelf" ? null : field;
  // The raw rows are keyed as the bulk editor's suggestions are, so one fetch serves both.
  const shape = useCallback(
    (rows: NamedCount[]) => (named ? shapeNamed(named, rows) : undefined),
    [named],
  );
  const query = useQuery({
    ...nameCountsQuery(named ?? "tag"),
    // Format and shelf fields read no names; the placeholder key is never fetched.
    enabled: named !== null,
    select: shape,
  });
  if (field === "format") {
    return { state: "ready", list: { options: formatOptions(), cap: null } };
  }
  if (field === "shelf") {
    if (shelves.data) {
      const options = shelfOptions(shelves.data, viewerId);
      return { state: "ready", list: { options, cap: null } };
    }
    return shelves.isError
      ? {
          state: "failed",
          message: shelves.error.message,
          retry: () => shelves.refetch(),
        }
      : { state: "loading" };
  }
  // A refetch that fails leaves the list it already has on screen.
  if (query.isError && !query.data) {
    return {
      state: "failed",
      message: query.error.message,
      retry: () => query.refetch(),
    };
  }
  return query.data
    ? { state: "ready", list: query.data }
    : { state: "loading" };
}

type PickerProps = {
  /** The clause the menu opens on: its field, mode and values. */
  initial: FilterClause;
  onApply: (clause: FilterClause) => void;
  onClose: () => void;
};

function Rows({
  plural,
  query,
  picked,
  list,
  onToggle,
}: {
  plural: string;
  query: string;
  picked: string[];
  list: OptionList;
  onToggle: (value: string) => void;
}) {
  const found = useMemo(
    () => matching(list.options, query, MAX_SHOWN_OPTIONS),
    [list, query],
  );
  if (list.options.length === 0) {
    return <p className="fb-empty">No {plural} yet.</p>;
  }
  if (found.total === 0) {
    return <p className="fb-empty">{noMatchLine(plural, query, list.cap)}</p>;
  }
  const atCap = picked.length >= MAX_FILTER_VALUES;
  const status = statusLine(plural, found.shown.length, found.total, list.cap);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width that the fb rules never reset */}
      <div className="fb-options" role="group" aria-label={plural}>
        {found.shown.map((option) => {
          const on = isPicked(picked, option.value);
          return (
            <label key={option.value} className="fb-opt">
              <input
                type="checkbox"
                aria-label={option.label}
                checked={on}
                disabled={!on && atCap}
                onChange={() => onToggle(option.value)}
              />
              <span className="fb-opt-label">{option.label}</span>
              {option.count !== null && (
                <span className="fb-opt-count" aria-hidden="true">
                  {option.count}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {status && <p className="fb-status">{status}</p>}
      {atCap && (
        <p className="fb-status">
          At most {MAX_FILTER_VALUES} values per filter
        </p>
      )}
    </>
  );
}

/** A facet's menu: include or exclude, then a searchable multi-select of the field's values. */
export function FilterPicker({ initial, onApply, onClose }: PickerProps) {
  const field = initial.field;
  const [mode, setMode] = useState<FilterMode>(initial.mode);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(initial.values);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);

  const loaded = useOptions(field);
  const plural = fieldPlural(field);
  const by = fieldLabel(field).toLowerCase();
  // Apply stays live with nothing picked only when it would clear the field.
  const canClear = initial.values.length > 0;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Escape closes the menu from the keyboard; the scrim is the pointer's way out */}
      <div className="fb-scrim" onClick={onClose} />
      <div
        ref={dialog}
        className="fb-pop"
        role="dialog"
        aria-modal="true"
        aria-label={`Filter by ${by}`}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          trapTab(e, e.currentTarget);
        }}
      >
        <div className="fb-body">
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width that the fb rules never reset */}
          <div className="fb-modes" role="group" aria-label="Match mode">
            {(
              [
                ["include", "Includes any"],
                ["exclude", "Excludes any"],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                className="fb-mode"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {text}
              </button>
            ))}
          </div>
          <input
            className="fb-search"
            type="search"
            aria-label={`Search ${plural}`}
            placeholder={`Search ${plural}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="fb-list">
            {loaded.state === "loading" && (
              <Loading kind="sheet" label={`Loading ${plural}…`} />
            )}
            {loaded.state === "failed" && (
              <div className="fb-error" role="alert">
                <p>Couldn’t load {plural}.</p>
                <p className="fb-error-detail">{loaded.message}</p>
                {loaded.retry && (
                  <Button size="sm" onClick={loaded.retry}>
                    Try again
                  </Button>
                )}
              </div>
            )}
            {loaded.state === "ready" && (
              <Rows
                plural={plural}
                query={query}
                picked={picked}
                list={withStranded(loaded.list, picked, field)}
                onToggle={(value) => setPicked(togglePick(picked, value))}
              />
            )}
          </div>
          <div className="fb-foot">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={picked.length === 0 && !canClear}
              onClick={() => onApply({ field, mode, values: picked })}
            >
              {picked.length ? `Apply (${picked.length})` : "Apply"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
