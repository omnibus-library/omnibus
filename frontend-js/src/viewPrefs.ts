import { z } from "zod";
import { type FilterClause, FilterClauseSchema, SortDir, SortKey } from "./api";

// The Dioxus client keeps the same keys and JSON (frontend/src/view_prefs.rs,
// shelf_selection.rs), and the React build is served on its origin, so the two
// read one store. Anything unreadable is the default.

export type ViewMode = "grid" | "table";

export type Prefs = {
  view: ViewMode;
  sort: SortKey;
  dir: SortDir;
  clauses: FilterClause[];
  // Never shown here, but carried through so a Dioxus value survives a save.
  filtersOpen: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  view: "grid",
  sort: "title",
  dir: "asc",
  clauses: [],
  filtersOpen: false,
};

// The facet lists an older client stored, read as include clauses.
const names = z.array(z.string()).default([]);

const Stored = z.object({
  view_mode: z.enum(["grid", "table"]),
  sort_key: SortKey,
  sort_dir: SortDir,
  filters: z
    .object({
      clauses: z.array(FilterClauseSchema).default([]),
      authors: names,
      series: names,
      formats: names,
      tags: names,
      genres: names,
    })
    .prefault({}),
  filters_open: z.boolean().default(false),
});

const PREFS_PREFIX = "omnibus.view_prefs::";
const LAST_LIBRARY_KEY = "omnibus.view_prefs.last_library";
const SHELF_KEY = "omnibus.landing_shelf";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode: behave as if nothing was saved
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: the screen keeps its in-memory copy.
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(read(key) ?? "null");
  } catch {
    return null;
  }
}

/** The library path `savePrefs` last wrote for, so page 1 can ask in the saved order. */
export function lastLibrary(): string | null {
  return read(LAST_LIBRARY_KEY) || null;
}

/** The prefs saved for the library at `path`, or the defaults. */
export function loadPrefs(path: string): Prefs {
  const parsed = Stored.safeParse(readJson(PREFS_PREFIX + path));
  if (!parsed.success) return DEFAULT_PREFS;
  const stored = parsed.data;
  const { filters } = stored;
  const legacy = (
    [
      ["author", filters.authors],
      ["series", filters.series],
      ["format", filters.formats],
      ["tag", filters.tags],
      ["genre", filters.genres],
    ] as const
  )
    .filter(([, values]) => values.length > 0)
    .map(
      ([field, values]): FilterClause => ({ field, mode: "include", values }),
    );
  return {
    view: stored.view_mode,
    sort: stored.sort_key,
    dir: stored.sort_dir,
    clauses: [...legacy, ...filters.clauses],
    filtersOpen: stored.filters_open,
  };
}

/** Saves `prefs` for the library at `path` and points `lastLibrary` at it. */
export function savePrefs(path: string, prefs: Prefs) {
  const stored: z.input<typeof Stored> = {
    view_mode: prefs.view,
    sort_key: prefs.sort,
    sort_dir: prefs.dir,
    filters: { clauses: prefs.clauses },
    filters_open: prefs.filtersOpen,
  };
  write(PREFS_PREFIX + path, JSON.stringify(stored));
  write(LAST_LIBRARY_KEY, path);
}

/**
 * Where one edit is saved. Until page 1 names the library the pointer is only
 * a guess, so an edit goes under it only once that fetch has failed; otherwise
 * it stays `unsaved` for the reconcile to file.
 */
export function savePlan(
  libraryPath: string | null,
  pageFailed: boolean,
  last: string | null,
) {
  if (libraryPath !== null) return { writeTo: libraryPath, unsaved: false };
  return { writeTo: pageFailed ? last : null, unsaved: true };
}

export type Reconcile = "keep" | "adopt" | "save";

/** What page 1 naming the library `path` does to the prefs in memory. */
export function reconcile(
  reconciled: string | null,
  path: string,
  unsaved: boolean,
): Reconcile {
  if (unsaved) return "save";
  return reconciled === path ? "keep" : "adopt";
}

const StoredShelf = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("shelf"), id: z.number().int() }),
]);

export type ShelfSelection = z.infer<typeof StoredShelf>;

/** The lens the landing was last on, or the whole library. */
export function loadShelfSelection(): ShelfSelection {
  const parsed = StoredShelf.safeParse(readJson(SHELF_KEY));
  return parsed.success ? parsed.data : { kind: "all" };
}

export function saveShelfSelection(selection: ShelfSelection) {
  write(SHELF_KEY, JSON.stringify(selection));
}
