import type { StatsSummary } from "../../api";
import { fixed } from "../../format";

type MonthCount = StatsSummary["books_per_month"][number];

export type MonthBar = {
  label: string;
  books: number;
  heightPct: number;
  /** The trailing month, which `books_per_month` always ends on. */
  current: boolean;
};

const INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** The first letter of a `YYYY-MM` month's name, `?` when malformed. */
export function monthInitial(month: string): string {
  const last = month.split("-").pop() ?? "";
  const m = /^\d+$/.test(last) ? Number(last) : 0;
  return INITIALS[m - 1] ?? "?";
}

/** Bar heights scaled to the tallest month; an all-zero window stays all zero. */
export function buildBars(months: readonly MonthCount[]): MonthBar[] {
  const max = Math.max(0, ...months.map((m) => m.books));
  return months.map((m, i) => ({
    label: monthInitial(m.month),
    books: m.books,
    heightPct: max <= 0 ? 0 : Math.trunc((Math.max(m.books, 0) * 100) / max),
    current: i === months.length - 1,
  }));
}

/** Mean books finished a month over the window, `null` when it carries no months. */
export function monthlyAverage(months: readonly MonthCount[]): number | null {
  if (months.length === 0) return null;
  return months.reduce((total, m) => total + m.books, 0) / months.length;
}

/** The header's "avg 1.5 / month", or nothing for an empty window. */
export function averageLabel(months: readonly MonthCount[]): string {
  const average = monthlyAverage(months);
  return average === null ? "" : `avg ${fixed(average, 1)} / month`;
}
