import type { Book, NamedCount } from "../../api";
import type { BulkMetadataEdit } from "../../api/generated/schemas";

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

/** The wire edit for `edit`: scalars trimmed and sent only when filled, authors only when given. */
export function bulkWire(edit: BulkEdit): BulkMetadataEdit {
  const wire: BulkMetadataEdit = {
    add_tags: edit.addTags,
    remove_tags: edit.removeTags,
    add_genres: edit.addGenres,
    remove_genres: edit.removeGenres,
  };
  if (edit.authors.length) wire.authors = edit.authors;
  for (const field of ["series", "publisher", "language"] as const) {
    const value = edit[field].trim();
    if (value) wire[field] = value;
  }
  return wire;
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
