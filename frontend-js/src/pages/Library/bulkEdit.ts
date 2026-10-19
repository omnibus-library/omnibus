import type { Book, NamedCount } from "../../api";
import type { MetadataOverrides } from "../../api/generated/schemas";

/** What the bulk modal collects: blank scalars and empty lists leave a book as it is. */
export type BulkEdit = {
  authors: string[];
  series: string;
  publisher: string;
  language: string;
  addTags: string[];
  removeTags: string[];
  addGenres: string[];
  removeGenres: string[];
};

export const NO_EDIT: BulkEdit = {
  authors: [],
  series: "",
  publisher: "",
  language: "",
  addTags: [],
  removeTags: [],
  addGenres: [],
  removeGenres: [],
};

/** Whether applying `edit` would change no book. */
export const isEmptyEdit = (edit: BulkEdit) =>
  edit.authors.length === 0 &&
  !edit.series.trim() &&
  !edit.publisher.trim() &&
  !edit.language.trim() &&
  edit.addTags.length === 0 &&
  edit.removeTags.length === 0 &&
  edit.addGenres.length === 0 &&
  edit.removeGenres.length === 0;

/** `current` without the exact matches of `remove`, then each `add` it lacks, order kept. */
export function applyDelta(
  current: string[],
  remove: string[],
  add: string[],
): string[] {
  const kept = current.filter((value) => !remove.includes(value));
  for (const value of add) {
    if (!kept.includes(value)) kept.push(value);
  }
  return kept;
}

/** The overrides that turn `book` into what `edit` asks for, holding only what changes. */
export function overridesFor(book: Book, edit: BulkEdit): MetadataOverrides {
  const overrides: MetadataOverrides = {};
  if (edit.authors.length) {
    overrides.creators = edit.authors.map((name) => ({ name }));
  }
  for (const field of ["series", "publisher", "language"] as const) {
    const value = edit[field].trim();
    if (value) overrides[field] = value;
  }
  if (edit.addTags.length || edit.removeTags.length) {
    overrides.subjects = applyDelta(
      book.subjects,
      edit.removeTags,
      edit.addTags,
    );
  }
  if (edit.addGenres.length || edit.removeGenres.length) {
    overrides.genres = applyDelta(
      book.genres,
      edit.removeGenres,
      edit.addGenres,
    );
  }
  return overrides;
}

/** The values some book carries, most shared first and then by name: all there is to remove. */
export function removable(
  books: Book[],
  field: "subjects" | "genres",
): NamedCount[] {
  const counts = new Map<string, number>();
  for (const value of books.flatMap((book) => book[field])) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}
