import { z } from "zod";
import type { GoalKind, GoalTargets } from "../../api";

type GoalField = {
  kind: GoalKind;
  label: string;
  unit: string;
  hint: string;
  max: number;
  testId: string;
};

const BOOKS: GoalField = {
  kind: "books",
  label: "Books this year",
  unit: "book",
  hint: "Counts a book once, the day you finish it.",
  max: 10000,
  testId: "goal-books",
};
const PAGES: GoalField = {
  kind: "pages",
  label: "Pages a day",
  unit: "page",
  hint: "Estimated from how far you move through each book.",
  max: 2000,
  testId: "goal-pages",
};
const MINUTES: GoalField = {
  kind: "minutes",
  label: "Minutes a day",
  unit: "minute",
  hint: "Reading and listening together, on your own clock.",
  max: 1440,
  testId: "goal-minutes",
};

/** The goals in the order a reader sets them: the year first, then the two dailies that feed it. */
export const GOAL_FIELDS: readonly GoalField[] = [BOOKS, PAGES, MINUTES];

// An empty draft is a deliberate clear, which is how the form says "no target".
const target = ({ unit, max }: GoalField) =>
  z.string().transform((draft, ctx): number | null => {
    const text = draft.trim();
    if (text === "") return null;
    const n = Number(text);
    if (!/^[+-]?\d+$/.test(text)) {
      ctx.addIssue({
        code: "custom",
        message: `Enter a whole number of ${unit}s.`,
      });
      return z.NEVER;
    }
    if (n < 1 || n > max) {
      ctx.addIssue({
        code: "custom",
        message: `Pick a target between 1 and ${max}.`,
      });
      return z.NEVER;
    }
    return n;
  });

/** The drafts, by kind, as targets, or why each refused one was refused. */
export const GoalsSchema = z.object({
  books: target(BOOKS),
  pages: target(PAGES),
  minutes: target(MINUTES),
});

/** The goals a save should write: kind and new target for every one that moved, so an untouched target is never restated. */
export function changedUpdates(
  next: GoalTargets,
  saved: GoalTargets,
): { kind: GoalKind; target: number | null }[] {
  return GOAL_FIELDS.flatMap(({ kind }) =>
    next[kind] === saved[kind] ? [] : [{ kind, target: next[kind] }],
  );
}

/** The status after a save, naming the goals that did not land so the reader knows which to retry. */
export function saveSummary(failedLabels: string[]): {
  message: string;
  error: boolean;
} {
  switch (failedLabels.length) {
    case 0:
      return { message: "Goals saved.", error: false };
    case 1:
      return {
        message: `Saved, except ${failedLabels[0]} — try that one again.`,
        error: true,
      };
    default:
      return {
        message: `Saved, except ${failedLabels.join(" and ")} — try those again.`,
        error: true,
      };
  }
}
