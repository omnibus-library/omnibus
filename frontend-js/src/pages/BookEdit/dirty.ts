import { type MetaForm, sameList } from "../../api";

/** The names a changed field is listed under in the save bar and the form's edited markers. */
export type DirtyLabel =
  | "Title"
  | "Description"
  | "Publisher"
  | "Published"
  | "Language"
  | "Series"
  | "Book #"
  | "ISBN-13"
  | "ISBN-10"
  | "Print Pages"
  | "Authors"
  | "Tags"
  | "Genres";

/** The names of the fields whose value differs from `baseline`, in the form's order. */
export function dirtyLabels(
  baseline: MetaForm,
  values: MetaForm,
): DirtyLabel[] {
  const changed: [DirtyLabel, boolean][] = [
    ["Title", values.title !== baseline.title],
    ["Description", values.description !== baseline.description],
    ["Publisher", values.publisher !== baseline.publisher],
    ["Published", values.published !== baseline.published],
    ["Language", values.language !== baseline.language],
    ["Series", values.series !== baseline.series],
    ["Book #", values.seriesIndex !== baseline.seriesIndex],
    ["ISBN-13", values.isbn13 !== baseline.isbn13],
    ["ISBN-10", values.isbn10 !== baseline.isbn10],
    ["Print Pages", values.printPages.trim() !== baseline.printPages],
    ["Authors", !sameList(values.authors, baseline.authors)],
    ["Tags", !sameList(values.tags, baseline.tags)],
    ["Genres", !sameList(values.genres, baseline.genres)],
  ];
  return changed.filter(([, differs]) => differs).map(([label]) => label);
}

const fields = (count: number) => `${count} field${count === 1 ? "" : "s"}`;

/** "N field(s) edited", for the save bar. */
export const editedSummary = (count: number) => `${fields(count)} edited`;

/** The primary button's text: what pressing it does right now. */
export function saveLabel(
  saving: boolean,
  count: number,
  creating = false,
): string {
  if (creating) return saving ? "Adding…" : "Add to library";
  if (saving) return "Saving…";
  return count > 0 ? `Save · ${fields(count)}` : "Done";
}
