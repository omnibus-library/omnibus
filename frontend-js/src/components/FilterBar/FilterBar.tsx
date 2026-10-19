import { useRef, useState } from "react";
import type { FilterClause, FilterField, UserId } from "../../api";
import { ChevronDownGlyph, XGlyph } from "../Glyphs/Glyphs";
import { FilterPicker } from "./FilterPicker";
import {
  FILTER_FIELDS,
  facetValue,
  fieldLabel,
  MAX_FILTER_CLAUSES,
  type ShelfList,
  withFieldClause,
  withoutField,
} from "./filters";
import "./FilterBar.css";

type FilterBarProps = {
  clauses: FilterClause[];
  shelves: ShelfList;
  viewerId: UserId;
  /** Called with the whole next clause list. */
  onChange: (clauses: FilterClause[]) => void;
};

function Facet({
  field,
  clauses,
  shelves,
  viewerId,
  onChange,
}: FilterBarProps & { field: FilterField }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const clause = clauses.find((c) => c.field === field);
  // A filter saved before one clause per field can already be at the cap.
  const atCap = !clause && clauses.length >= MAX_FILTER_CLAUSES;
  const label = fieldLabel(field);
  // The menu and the clear button unmount with focus inside them; hand it back.
  const refocus = () => trigger.current?.focus();
  return (
    <div className={clause ? "fb-facet-wrap on" : "fb-facet-wrap"}>
      <button
        ref={trigger}
        type="button"
        className="fb-facet"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={atCap}
        title={atCap ? `At most ${MAX_FILTER_CLAUSES} filters` : undefined}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        {clause && (
          <span className="fb-facet-v">
            {facetValue(clause, shelves, viewerId).map((part) =>
              part === null ? (
                <span key="pending" className="ld-sheen">
                  …
                </span>
              ) : (
                part
              ),
            )}
          </span>
        )}
        <ChevronDownGlyph />
      </button>
      {clause && (
        <button
          type="button"
          className="fb-facet-x"
          aria-label={`Clear the ${label} filter`}
          onClick={() => {
            onChange(withoutField(clauses, field));
            refocus();
          }}
        >
          <XGlyph />
        </button>
      )}
      {open && (
        <FilterPicker
          shelves={shelves}
          viewerId={viewerId}
          initial={clause ?? { field, mode: "include", values: [] }}
          onApply={(next) => {
            onChange(withFieldClause(clauses, next));
            setOpen(false);
            refocus();
          }}
          onClose={() => {
            setOpen(false);
            refocus();
          }}
        />
      )}
    </div>
  );
}

/** The library's filters as one facet per field; an active one names what it keeps. */
export function FilterBar(props: FilterBarProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width that the fb rules never reset
    <div className="fb" role="group" aria-label="Library filters">
      {FILTER_FIELDS.map((field) => (
        <Facet key={field} field={field} {...props} />
      ))}
      {props.clauses.length > 0 && (
        <button
          type="button"
          className="fb-clear"
          onClick={() => props.onChange([])}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
