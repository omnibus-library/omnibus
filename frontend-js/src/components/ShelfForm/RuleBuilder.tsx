import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { previewShelfRule } from "../../api";
import type { MatchMode, RuleField } from "../../api/generated/schemas";
import { CoverImage } from "../Cover/CoverImage";
import { Loading, Stale } from "../Loading/Loading";
import {
  accepts,
  BLANK_DRAFT,
  FIELDS,
  isDate,
  OPS,
  previewRequest,
  previewState,
  type RuleDraft,
  STATUS_VALUES,
  UNITS,
  withField,
} from "./rules";
import "./ShelfForm.css";

const PLACEHOLDERS: Partial<Record<RuleField, string>> = {
  rating: "4",
  year: "2024",
  genre: "genre name",
  author: "author name",
  series: "series name",
};

type RowProps = {
  draft: RuleDraft;
  onChange: (draft: RuleDraft) => void;
};

function ValueInputs({ draft, onChange }: RowProps) {
  const { field, op, value, value2, unit } = draft;
  const set = (change: Partial<RuleDraft>) => onChange({ ...draft, ...change });
  if (isDate(field)) {
    if (op === "in_last") {
      return (
        <div className="shelf-value-group">
          <input
            type="number"
            min="1"
            className="shelf-value shelf-value--num"
            placeholder="30"
            aria-label="Condition value"
            value={value}
            onChange={(e) => set({ value: e.target.value })}
          />
          <select
            className="shelf-select"
            aria-label="Condition window"
            value={unit}
            onChange={(e) => {
              const next = UNITS.find(([u]) => u === e.target.value);
              if (next) set({ unit: next[0] });
            }}
          >
            {UNITS.map(([u, label]) => (
              <option key={u} value={u}>
                {label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (op === "between") {
      return (
        <div className="shelf-value-group">
          <input
            type="date"
            className="shelf-value"
            aria-label="Condition start date"
            value={value}
            onChange={(e) => set({ value: e.target.value })}
          />
          <span className="shelf-value-sep">to</span>
          <input
            type="date"
            className="shelf-value"
            aria-label="Condition end date"
            value={value2}
            onChange={(e) => set({ value2: e.target.value })}
          />
        </div>
      );
    }
    return (
      <input
        type="date"
        className="shelf-value"
        aria-label="Condition date"
        value={value}
        onChange={(e) => set({ value: e.target.value })}
      />
    );
  }
  // Status is a closed set: a dropdown, not free text.
  if (field === "status") {
    return (
      <select
        className="shelf-select"
        aria-label="Condition value"
        value={value || STATUS_VALUES[0]}
        onChange={(e) => set({ value: e.target.value })}
      >
        {STATUS_VALUES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    );
  }
  const numeric = field === "rating" || field === "year";
  return (
    <input
      type={numeric ? "number" : "text"}
      step={field === "rating" ? "0.5" : "1"}
      className="shelf-value"
      placeholder={PLACEHOLDERS[field] ?? "value"}
      aria-label="Condition value"
      value={value}
      onChange={(e) => set({ value: e.target.value })}
    />
  );
}

function ConditionRow({
  index,
  draft,
  canRemove,
  onChange,
  onRemove,
}: RowProps & { index: number; canRemove: boolean; onRemove: () => void }) {
  return (
    <div className="shelf-condition" data-testid={`condition-row-${index}`}>
      <select
        className="shelf-select"
        aria-label="Condition field"
        data-testid={`condition-field-${index}`}
        value={draft.field}
        onChange={(e) => {
          const next = FIELDS.find(([f]) => f === e.target.value);
          if (next) onChange(withField(draft, next[0]));
        }}
      >
        {FIELDS.map(([field, label]) => (
          <option key={field} value={field}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="shelf-select"
        aria-label="Condition operator"
        data-testid={`condition-op-${index}`}
        value={draft.op}
        onChange={(e) => {
          const next = OPS.find(([o]) => o === e.target.value);
          if (next) onChange({ ...draft, op: next[0] });
        }}
      >
        {OPS.filter(([op]) => accepts(draft.field, op)).map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </select>
      <ValueInputs draft={draft} onChange={onChange} />
      {canRemove && (
        <button
          type="button"
          className="shelf-condition-remove"
          data-testid={`condition-remove-${index}`}
          aria-label="Remove condition"
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  );
}

function Preview({
  matchMode,
  drafts,
}: {
  matchMode: MatchMode;
  drafts: RuleDraft[];
}) {
  const body = previewRequest(matchMode, drafts);
  const hasRules = body.rules.length > 0;
  const preview = useQuery({
    queryKey: ["shelf-preview", body.match_mode, body.rules],
    queryFn: () => previewShelfRule(body),
    enabled: hasRules,
    // The last answer stays up, dimmed, while the next one loads.
    placeholderData: keepPreviousData,
  });
  const state = previewState(hasRules, preview.isFetching, preview.isError);
  if (state === "noRules") {
    return (
      <p className="shelf-preview-empty mono">
        Add a condition to preview matches.
      </p>
    );
  }
  if (!preview.data) {
    return state === "failed" ? (
      <p
        className="shelf-preview-empty mono"
        role="alert"
        data-testid="rule-preview-error"
      >
        Couldn’t preview these conditions.
      </p>
    ) : (
      <Loading label="Finding matches" />
    );
  }
  const { matched, total, sample } = preview.data;
  return (
    <Stale stale={state === "pending"}>
      <p className="shelf-preview-count" data-testid="rule-preview-count">
        <em>{matched}</em>
        {` of ${total} match`}
      </p>
      <div className="shelf-preview-grid">
        {sample.map((book) => (
          <div key={book.uuid}>
            <div className="shelf-cover-tile">
              <CoverImage book={book} sizes="120px" />
            </div>
          </div>
        ))}
      </div>
    </Stale>
  );
}

type RuleBuilderProps = {
  matchMode: MatchMode;
  drafts: RuleDraft[];
  onMatchMode: (mode: MatchMode) => void;
  onDrafts: (drafts: RuleDraft[]) => void;
};

/** The condition rows and the live preview they match, for the create and edit shelf modals. */
export function RuleBuilder({
  matchMode,
  drafts,
  onMatchMode,
  onDrafts,
}: RuleBuilderProps) {
  return (
    <div className="shelf-smart">
      <div className="shelf-smart-editor">
        <div className="shelf-match-row">
          <span>Match</span>
          <select
            className="shelf-select"
            aria-label="Match"
            data-testid="shelf-match-mode"
            value={matchMode}
            onChange={(e) => {
              if (e.target.value === "any" || e.target.value === "all") {
                onMatchMode(e.target.value);
              }
            }}
          >
            <option value="any">any</option>
            <option value="all">all</option>
          </select>
          <span>of these conditions</span>
        </div>
        {drafts.map((draft, i) => (
          <ConditionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: a row has no identity beyond its place
            key={i}
            index={i}
            draft={draft}
            canRemove={drafts.length > 1}
            onChange={(next) =>
              onDrafts(drafts.map((d, j) => (j === i ? next : d)))
            }
            onRemove={() => onDrafts(drafts.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          className="shelf-add-condition"
          data-testid="add-condition"
          onClick={() => onDrafts([...drafts, BLANK_DRAFT])}
        >
          ＋ Add condition
        </button>
      </div>
      <div className="shelf-preview">
        <Preview matchMode={matchMode} drafts={drafts} />
      </div>
    </div>
  );
}
