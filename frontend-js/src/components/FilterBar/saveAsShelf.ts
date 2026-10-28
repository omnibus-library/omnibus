import type { FilterClause, UserId } from "../../api";
import {
  BLANK_DRAFT,
  type RuleDraft,
  type ShelfSeed,
} from "../ShelfForm/rules";
import {
  facetValue,
  fieldLabel,
  type ShelfLookup,
  valueLabel,
} from "./filters";

// Mirrors MAX_PREVIEW_RULES in shared/src/shelves.rs (the create endpoint's cap).
const MAX_SHELF_RULES = 50;
const MAX_NAME_CHARS = 120;

const SHELF_REASON = "a shelf can't be a condition";
const FORMAT_REASON = "a condition can't exclude a format";
const MANY_REASON = "several values alongside another filter";
const CAP_REASON = `a shelf holds at most ${MAX_SHELF_RULES} conditions`;

type Entry = { clause: FilterClause; values: string[] };

const refusal = ({ field, mode }: FilterClause) =>
  field === "shelf"
    ? SHELF_REASON
    : field === "format" && mode === "exclude"
      ? FORMAT_REASON
      : null;

const hasSeveral = ({ clause, values }: Entry) =>
  clause.mode === "include" && values.length > 1;

function draftsFor({ clause: { field, mode }, values }: Entry): RuleDraft[] {
  // Only narrows the field to a rule's; a shelf clause is refused before it gets here.
  if (field === "shelf") return [];
  const op =
    mode === "exclude" ? "is_not" : field === "format" ? "includes" : "is";
  return values.map((value) => ({ ...BLANK_DRAFT, field, op, value }));
}

// A shelf is never carried, so its label is never pending here.
const valueName = (
  { clause: { field, mode } }: Entry,
  value: string,
  shelves: ShelfLookup,
  viewerId: UserId,
) =>
  `${mode === "exclude" ? "not " : ""}${valueLabel(field, value, shelves, viewerId) ?? ""}`;

const clip = (name: string) => {
  const chars = [...name];
  return chars.length > MAX_NAME_CHARS
    ? `${chars.slice(0, MAX_NAME_CHARS - 1).join("")}…`
    : name;
};

/**
 * The smart shelf that keeps the same books as `clauses`, and a note on what
 * it could not carry. Includes OR within a clause and clauses AND, so a
 * clause with several values carries only as the sole carried clause (match
 * any); excludes become `is_not` conditions that AND.
 */
export function saveAsShelf(
  clauses: FilterClause[],
  shelves: ShelfLookup,
  viewerId: UserId,
): ShelfSeed {
  const usable: Entry[] = clauses
    .map((clause) => ({
      clause,
      values: clause.values.map((v) => v.trim()).filter(Boolean),
    }))
    .filter((e) => e.values.length > 0);
  const fits = (e: Entry) => e.values.length <= MAX_SHELF_RULES;
  const carriable = usable.filter((e) => !refusal(e.clause) && fits(e));
  const several = carriable.filter(hasSeveral);
  const anyMode = several.length > 0 && several.length === carriable.length;

  const carried: Entry[] = [];
  const leftOut: { entry: Entry; reason: string }[] = [];
  let total = 0;
  for (const entry of usable) {
    const reason =
      refusal(entry.clause) ??
      (!fits(entry)
        ? CAP_REASON
        : hasSeveral(entry) && !(anyMode && entry === several[0])
          ? MANY_REASON
          : total + entry.values.length > MAX_SHELF_RULES
            ? CAP_REASON
            : null);
    if (reason) {
      leftOut.push({ entry, reason });
    } else {
      carried.push(entry);
      total += entry.values.length;
    }
  }

  const parts = [
    carried.length > 0 &&
      `${carried.map((e) => fieldLabel(e.clause.field)).join(", ")} carried.`,
    ...leftOut.map(({ entry, reason }) => {
      const shown = facetValue(entry.clause, shelves, viewerId)
        .map((part) => part ?? "…")
        .join("");
      return `${fieldLabel(entry.clause.field)} · ${shown} left out, ${reason}.`;
    }),
  ].filter(Boolean);

  return {
    name: clip(
      carried
        .flatMap((e) => e.values.map((v) => valueName(e, v, shelves, viewerId)))
        .join(" · "),
    ),
    matchMode: anyMode ? "any" : "all",
    drafts: carried.flatMap(draftsFor),
    note: parts.length > 0 ? `From your filters: ${parts.join(" ")}` : "",
  };
}
