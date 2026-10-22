import { type MetaForm, sameList } from "../../api";

/** The names of the fields whose value differs from `baseline`, in the form's order. */
export function dirtyLabels(baseline: MetaForm, values: MetaForm) {
  const changed = [
    ["Title", values.title !== baseline.title],
    ["Description", values.description !== baseline.description],
    ["Publisher", values.publisher !== baseline.publisher],
    ["Published", values.published !== baseline.published],
    ["Language", values.language !== baseline.language],
    ["Series", values.series !== baseline.series],
    ["Number in series", values.seriesIndex !== baseline.seriesIndex],
    ["ISBN-13", values.isbn13 !== baseline.isbn13],
    ["ISBN-10", values.isbn10 !== baseline.isbn10],
    ["Print pages", values.printPages.trim() !== baseline.printPages],
    ["Authors", !sameList(values.authors, baseline.authors)],
    ["Tags", !sameList(values.tags, baseline.tags)],
    ["Genres", !sameList(values.genres, baseline.genres)],
  ] as const;
  return changed.filter(([, differs]) => differs).map(([label]) => label);
}

/** The names a changed field is listed under in the save bar and the form's edited markers. */
export type DirtyLabel = ReturnType<typeof dirtyLabels>[number];

const fields = (count: number) => `${count} field${count === 1 ? "" : "s"}`;

/** "N field(s) edited", for the save bar. */
export const editedSummary = (count: number) => `${fields(count)} edited`;

/** "No changes", "1 unsaved change", "3 unsaved changes": the editor sheet's save bar. */
export const unsavedSummary = (count: number) =>
  count === 0
    ? "No changes"
    : `${count} unsaved change${count === 1 ? "" : "s"}`;

/** What the sheet asks when it is left with `count` changes unsaved. */
export const leavePrompt = (count: number) =>
  count === 1
    ? "Save your change before closing?"
    : `Save your ${count} changes before closing?`;

/** The primary button's text on the add page: what pressing it does right now. */
export const saveLabel = (saving: boolean) =>
  saving ? "Adding…" : "Add to library";
