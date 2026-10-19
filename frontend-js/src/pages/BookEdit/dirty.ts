import { type MetaForm, sameList } from "../../api";

/** The names of the fields whose value differs from `baseline`, in the form's order. */
export function dirtyLabels(baseline: MetaForm, values: MetaForm): string[] {
  const changed: [string, boolean][] = [
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
export function saveLabel(saving: boolean, count: number): string {
  if (saving) return "Saving…";
  return count > 0 ? `Save · ${fields(count)}` : "Done";
}
