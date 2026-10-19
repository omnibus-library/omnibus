import type { Shelf } from "../../api";
import type {
  MatchMode,
  RuleField,
  RuleOp,
  ShelfRule,
} from "../../api/generated/schemas";

// Mirrors shared/src/shelves.rs and the Dioxus rule builder, labels and order included.
export const FIELDS = [
  ["tag", "Tag"],
  ["genre", "Genre"],
  ["author", "Author"],
  ["series", "Series"],
  ["rating", "Rating"],
  ["status", "Reading status"],
  ["format", "Format"],
  ["year", "Year"],
  ["date_added", "Date added"],
  ["date_updated", "Date updated"],
] as const satisfies readonly [RuleField, string][];

export const OPS = [
  ["is", "is"],
  ["is_not", "is not"],
  ["contains", "contains"],
  ["starts_with", "starts with"],
  ["gte", "is at least"],
  ["includes", "includes"],
  ["in_last", "in the last"],
  ["between", "between"],
  ["before", "before"],
  ["after", "after"],
] as const satisfies readonly [RuleOp, string][];

/** The values a `status` condition can take; the first is what a newly picked Status field seeds. */
export const STATUS_VALUES = ["finished", "reading", "unread"] as const;

export const UNITS = [
  ["d", "days"],
  ["w", "weeks"],
  ["m", "months"],
  ["y", "years"],
] as const;

export type DateUnit = (typeof UNITS)[number][0];

const TEXT_OPS = ["is", "is_not", "contains", "starts_with"] as const;
const ACCEPTED: Record<RuleField, readonly RuleOp[]> = {
  tag: TEXT_OPS,
  genre: TEXT_OPS,
  author: TEXT_OPS,
  series: TEXT_OPS,
  rating: ["is", "gte"],
  status: ["is"],
  format: ["includes", "contains", "starts_with"],
  year: ["is", "gte"],
  date_added: ["in_last", "between", "before", "after"],
  date_updated: ["in_last", "between", "before", "after"],
};

/** Whether `op` is valid for `field`. */
export const accepts = (field: RuleField, op: RuleOp) =>
  ACCEPTED[field].includes(op);

/** Whether `field` is one of the two acquisition dates. */
export const isDate = (field: RuleField) =>
  field === "date_added" || field === "date_updated";

/** A rule row's working state: the raw inputs `toRule` folds into a wire rule. */
export type RuleDraft = {
  field: RuleField;
  op: RuleOp;
  value: string;
  /** The second date of `between`. */
  value2: string;
  /** The window of `in_last`. */
  unit: DateUnit;
};

export const BLANK_DRAFT: RuleDraft = {
  field: "tag",
  op: "is",
  value: "",
  value2: "",
  unit: "d",
};

/** The wire rule for a draft, or `null` until every input its op needs is filled. */
export function toRule({ field, op, value, value2, unit }: RuleDraft) {
  const first = value.trim();
  const second = value2.trim();
  if (!first || (op === "between" && !second)) return null;
  const encoded =
    op === "in_last"
      ? `${first}${unit}`
      : op === "between"
        ? `${first}..${second}`
        : first;
  return { field, op, value: encoded } satisfies ShelfRule;
}

/** The draft a saved rule edits as, reversing `toRule`. */
export function fromRule({ field, op, value }: ShelfRule): RuleDraft {
  if (op === "in_last") {
    const unit = UNITS.find(([u]) => u === value.slice(-1))?.[0] ?? "d";
    return { field, op, value: value.slice(0, -1), value2: "", unit };
  }
  if (op === "between") {
    const at = value.indexOf("..");
    const [start, end] =
      at < 0 ? [value, ""] : [value.slice(0, at), value.slice(at + 2)];
    return { field, op, value: start, value2: end, unit: "d" };
  }
  return { field, op, value, value2: "", unit: "d" };
}

/** The draft with `field` picked: its op snaps to the first one the field accepts, and Status seeds a valid value. */
export function withField(draft: RuleDraft, field: RuleField): RuleDraft {
  const op = accepts(field, draft.op)
    ? draft.op
    : (OPS.find(([o]) => accepts(field, o))?.[0] ?? "is");
  const seeded =
    field === "status" && !STATUS_VALUES.some((s) => s === draft.value.trim());
  return {
    ...draft,
    field,
    op,
    value: seeded ? STATUS_VALUES[0] : draft.value,
  };
}

/** Where the live preview stands, whatever answer it holds. */
export type PreviewState = "noRules" | "pending" | "failed" | "settled";

export function previewState(
  hasRules: boolean,
  fetching: boolean,
  failed: boolean,
): PreviewState {
  if (!hasRules) return "noRules";
  if (fetching) return "pending";
  return failed ? "failed" : "settled";
}

const FIELD_LABEL = new Map<RuleField, string>(FIELDS);
const OP_LABEL = new Map<RuleOp, string>(OPS);

/** A rule in words: "Tag is Fantasy". */
export const ruleText = ({ field, op, value }: ShelfRule) =>
  `${FIELD_LABEL.get(field)} ${OP_LABEL.get(op)} ${value}`;

export const kindLabel = (kind: Shelf["kind"]) =>
  ({ smart: "Smart shelf", manual: "Hand-picked shelf", wishlist: "Wishlist" })[
    kind
  ];

export const visibilityLabel = (visibility: Shelf["visibility"]) =>
  visibility === "private" ? "Private" : "Public";

/** The body `POST /api/shelves/preview` takes: the complete rules under the match mode. */
export function previewRequest(matchMode: MatchMode, drafts: RuleDraft[]) {
  return {
    match_mode: matchMode,
    rules: drafts.flatMap((d) => toRule(d) ?? []),
  };
}
