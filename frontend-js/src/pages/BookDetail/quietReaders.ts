/**
 * The stoat's note for household readers who rated or reviewed a book and wrote no
 * journal entry: their names, and that their entries will appear. `null` when there are none.
 */
export function quietReadersNote(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const who = new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  const verb = names.length === 1 ? "hasn't" : "haven't";
  return `${who} rated or reviewed this book but ${verb} shared journal entries. When they do, they show up here.`;
}
