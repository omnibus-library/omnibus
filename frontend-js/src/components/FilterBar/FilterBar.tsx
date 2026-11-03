import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { type FilterClause, type FilterField, shelvesQuery } from "../../api";
import { useCurrentUser } from "../../session";
import { ChevronDownGlyph, XGlyph } from "../Glyphs/Glyphs";
import { CreateShelfModal } from "../ShelfForm/CreateShelfModal";
import type { ShelfSeed } from "../ShelfForm/rules";
import { FilterPicker } from "./FilterPicker";
import {
  FILTER_FIELDS,
  facetValue,
  fieldLabel,
  MAX_FILTER_CLAUSES,
  revealBelow,
  withFieldClause,
  withoutField,
} from "./filters";
import { saveAsShelf } from "./saveAsShelf";
import "./FilterBar.css";

type FilterBarProps = {
  clauses: FilterClause[];
  /** Called with the whole next clause list. */
  onChange: (clauses: FilterClause[]) => void;
  /** Offers to save the filters as a smart shelf; only right where the bar filters the whole library. */
  saveAsShelf?: boolean;
};

function Facet({
  field,
  clauses,
  onChange,
}: FilterBarProps & { field: FilterField }) {
  const shelves = useQuery(shelvesQuery);
  const viewerId = useCurrentUser().id;
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
        onClick={() => {
          if (!open && trigger.current) revealBelow(trigger.current);
          setOpen(!open);
        }}
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
  const shelves = useQuery(shelvesQuery);
  const viewerId = useCurrentUser().id;
  const client = useQueryClient();
  // The seed the reader saved from, so the form shows what they clicked on.
  const [saving, setSaving] = useState<ShelfSeed | null>(null);
  const seed =
    props.saveAsShelf && props.clauses.length > 0
      ? saveAsShelf(props.clauses, shelves, viewerId)
      : null;
  const nothingToSave = seed?.drafts.length === 0;
  const noteId = useId();
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a default border and min-width that the fb rules never reset */}
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
        {seed && (
          // aria-disabled, not disabled: a disabled button drops out of the tab order, taking its reason with it.
          <>
            <button
              type="button"
              className="fb-save"
              aria-disabled={nothingToSave}
              aria-describedby={nothingToSave ? noteId : undefined}
              title={nothingToSave ? seed.note : undefined}
              onClick={() => {
                if (!nothingToSave) setSaving(seed);
              }}
            >
              Save as shelf
            </button>
            {nothingToSave && (
              <span id={noteId} className="sr-only">
                {seed.note}
              </span>
            )}
          </>
        )}
      </div>
      {saving && (
        <CreateShelfModal
          initial={saving}
          onClose={() => setSaving(null)}
          onCreated={() => {
            setSaving(null);
            client.invalidateQueries({ queryKey: shelvesQuery.queryKey });
          }}
        />
      )}
    </>
  );
}
