import type { FilterClause, FilterField, Shelf, UserId } from "../../api";

export const MAX_FILTER_CLAUSES = 16;
export const MAX_FILTER_VALUES = 64;
export const MAX_SHOWN_OPTIONS = 200;
/** How many rows the tag and genre clouds stop at. */
export const CLOUD_LIMIT = 500;
const MAX_VALUE_LENGTH = 512;

/** The bar's facets, in order. */
export const FILTER_FIELDS: FilterField[] = [
  "shelf",
  "tag",
  "genre",
  "author",
  "series",
  "format",
];

const LABELS: Record<FilterField, string> = {
  shelf: "Shelf",
  tag: "Tag",
  genre: "Genre",
  author: "Author",
  series: "Series",
  format: "Format",
};

const PLURALS: Record<FilterField, string> = {
  shelf: "shelves",
  tag: "tags",
  genre: "genres",
  author: "authors",
  series: "series",
  format: "formats",
};

export const fieldLabel = (field: FilterField) => LABELS[field];
export const fieldPlural = (field: FilterField) => PLURALS[field];

/** The shelves query as a label sees it: no data and no error is still pending. */
type ShelfLookup = { data?: Shelf[]; isError: boolean };

/** One selectable value: what the filter stores, what the reader sees, and the book count when known. */
export type FilterOption = {
  value: string;
  label: string;
  count: number | null;
};

/** A field's options; `cap` is set when the source stopped at its most-used values. */
export type OptionList = { options: FilterOption[]; cap: number | null };

/** `clauses` with every clause on the clause's field swapped for it; one without values clears the field. */
export function withFieldClause(
  clauses: FilterClause[],
  clause: FilterClause,
): FilterClause[] {
  const rest = withoutField(clauses, clause.field);
  return clause.values.some((v) => v.trim()) ? [...rest, clause] : rest;
}

export const withoutField = (clauses: FilterClause[], field: FilterField) =>
  clauses.filter((c) => c.field !== field);

/** `s` with A-Z lowercased and nothing else: the fold the filter engine compares names by. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export const sameName = (a: string, b: string) =>
  asciiLower(a) === asciiLower(b);

/** `value` ticked or unticked in `picked`, ignoring ASCII case; a new pick past the cap is refused. */
export function togglePick(picked: string[], value: string): string[] {
  if (picked.some((p) => sameName(p, value))) {
    return picked.filter((p) => !sameName(p, value));
  }
  return picked.length < MAX_FILTER_VALUES ? [...picked, value] : picked;
}

export const isPicked = (picked: string[], value: string) =>
  picked.some((p) => sameName(p, value));

/** The owner a shelf is credited to, or `null` for the viewer's own and for a wishlist, whose name opens with its owner. */
export function attributedOwner(shelf: Shelf, viewerId: UserId): string | null {
  return shelf.ownerId !== viewerId && shelf.kind !== "wishlist"
    ? shelf.ownerName
    : null;
}

/** A shelf's name, then its owner's when it is another reader's, so two shelves with one name stay apart. */
export function shelfLabel(shelf: Shelf, viewerId: UserId): string {
  const owner = attributedOwner(shelf, viewerId);
  return owner === null ? shelf.name : `${shelf.name} · ${owner}`;
}

const UNAVAILABLE_SHELF = "unavailable shelf";

/** A value's name, or `null` while a shelf name is still being worked out. */
function valueLabel(
  field: FilterField,
  value: string,
  shelves: ShelfLookup,
  viewerId: UserId,
): string | null {
  if (field === "format") return value.toUpperCase();
  if (field !== "shelf") return value;
  if (!shelves.data) return shelves.isError ? UNAVAILABLE_SHELF : null;
  const shelf = shelves.data.find((s) => String(s.id) === value.trim());
  return shelf ? shelfLabel(shelf, viewerId) : UNAVAILABLE_SHELF;
}

/**
 * What an active facet shows after its field name: "not " ahead of an
 * exclusion, the first value (`null` while its name is pending), then " +N".
 */
export function facetValue(
  clause: FilterClause,
  shelves: ShelfLookup,
  viewerId: UserId,
): (string | null)[] {
  const [first, ...rest] = clause.values;
  return [
    ...(clause.mode === "exclude" ? ["not "] : []),
    ...(first === undefined
      ? []
      : [valueLabel(clause.field, first, shelves, viewerId)]),
    ...(rest.length ? [` +${rest.length}`] : []),
  ];
}

/**
 * Options for a field matched by name. The engine compares names ignoring
 * ASCII case, so spellings that differ only by case are one option (counts
 * added), and a name the filter would reject is left out rather than offered.
 */
export function namedOptions(
  rows: { name: string; count: number }[],
): FilterOption[] {
  const options: FilterOption[] = [];
  const at = new Map<string, FilterOption>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || [...name].length > MAX_VALUE_LENGTH) continue;
    const seen = at.get(asciiLower(name));
    if (seen) {
      seen.count = (seen.count ?? 0) + row.count;
      continue;
    }
    const option = { value: name, label: name, count: row.count };
    at.set(asciiLower(name), option);
    options.push(option);
  }
  return options;
}

/** Hand-picked and wishlist shelves, valued by shelf id. */
export function shelfOptions(
  shelves: Shelf[],
  viewerId: UserId,
): FilterOption[] {
  return shelves
    .filter((s) => s.kind !== "smart")
    .map((s) => ({
      value: String(s.id),
      label: shelfLabel(s, viewerId),
      count: s.bookCount,
    }));
}

const FORMATS = ["epub", "pdf", "cbz", "m4b", "m4a", "mp3"];

export const formatOptions = (): FilterOption[] =>
  FORMATS.map((f) => ({ value: f, label: f.toUpperCase(), count: null }));

/** The options whose label contains `query`, at most `limit` of them, and how many matched. */
export function matching(
  options: FilterOption[],
  query: string,
  limit: number,
): { shown: FilterOption[]; total: number } {
  const needle = query.trim().toLowerCase();
  const hits = options.filter((o) => o.label.toLowerCase().includes(needle));
  return { shown: hits.slice(0, limit), total: hits.length };
}

/** `list` with each of `picked` it no longer offers put first, so the reader can still untick it. */
export function withStranded(
  list: OptionList,
  picked: string[],
  field: FilterField,
): OptionList {
  const stranded = picked
    .filter((v) => !list.options.some((o) => sameName(o.value, v)))
    .map((value) => ({
      value,
      label:
        field === "shelf"
          ? UNAVAILABLE_SHELF
          : field === "format"
            ? value.toUpperCase()
            : value,
      count: null,
    }));
  return stranded.length
    ? { ...list, options: [...stranded, ...list.options] }
    : list;
}

/** The line under the rows: how a row cap cut the matches, and that a full cloud holds only its most-used values. */
export function statusLine(
  plural: string,
  shown: number,
  total: number,
  cap: number | null,
): string | null {
  if (cap !== null) {
    return `Showing ${shown} of the ${cap} most-used ${plural} · search narrows within them`;
  }
  return total > shown
    ? `Showing ${shown} of ${total} · search to narrow`
    : null;
}

/** What an unmatched search says; a full cloud may still hold the value. */
export function noMatchLine(
  plural: string,
  query: string,
  cap: number | null,
): string {
  const q = query.trim();
  return cap !== null
    ? `No ${plural} match “${q}” among the ${cap} most-used.`
    : `No ${plural} match “${q}”.`;
}
