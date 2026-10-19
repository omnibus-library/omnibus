import type { StatsRange } from "../../api";
import { RANGE_LABELS } from "./summary";

// Day math runs on epoch-day numbers over the stats' `YYYY-MM-DD` strings, with no date
// library, as the Rust page does, so every figure lands on the same day.

const div = (a: number, b: number) => Math.trunc(a / b);
const remEuclid = (a: number, b: number) => ((a % b) + b) % b;

/** Days since 1970-01-01 for a civil date (Howard Hinnant's `days_from_civil`). */
function daysFromCivil(y: number, m: number, d: number): number {
  const year = m <= 2 ? y - 1 : y;
  const era = div(year >= 0 ? year : year - 399, 400);
  const yoe = year - era * 400;
  const doy = div(153 * ((m + 9) % 12) + 2, 5) + d - 1;
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** Inverse of `daysFromCivil`: `[year, month, day]` for an epoch day. */
export function civilFromDays(days: number): [number, number, number] {
  const z = days + 719_468;
  const era = div(z >= 0 ? z : z - 146_096, 146_097);
  const doe = z - era * 146_097;
  const yoe = div(
    doe - div(doe, 1460) + div(doe, 36_524) - div(doe, 146_096),
    365,
  );
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100));
  const mp = div(5 * doy + 2, 153);
  const m = ((mp + 2) % 12) + 1;
  const y = yoe + era * 400;
  return [m <= 2 ? y + 1 : y, m, doy - div(153 * mp + 2, 5) + 1];
}

/** The epoch-day number of a `YYYY-MM-DD` string, or `null` when it isn't one. */
export function dayNumber(day: string): number | null {
  const parts = /^(\d+)-(\d+)-(\d+)$/.exec(day);
  if (!parts) return null;
  const [y, m, d] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? daysFromCivil(y, m, d) : null;
}

/** `YYYY-MM-DD` for an epoch-day number. */
export function dayString(days: number): string {
  const [y, m, d] = civilFromDays(days);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The full name of a 1-based month. */
export const monthName = (m: number) => MONTH_NAMES[m - 1] ?? "December";

/** The three-letter name of a 1-based month. */
const monthAbbr = (m: number) => monthName(m).slice(0, 3);

/**
 * What the switcher's window covers, off the server's `as_of_day` rather than the device
 * clock: "August 2026 · month to date". Without a server day it is the range's own label.
 */
export function windowLabel(range: StatsRange, asOfDay: string): string {
  const today = dayNumber(asOfDay);
  if (today === null) return RANGE_LABELS[range];
  const [year, month] = civilFromDays(today);
  switch (range) {
    case "week": {
      // Unix day 0 is a Thursday, so Monday-aligning subtracts (n + 3) % 7, as `db::stats` buckets weeks.
      const [y, m, d] = civilFromDays(today - remEuclid(today + 3, 7));
      return `Week of ${d} ${monthAbbr(m)} ${y} · to date`;
    }
    case "month":
      return `${monthName(month)} ${year} · month to date`;
    case "year":
      return `${year} · year to date`;
    case "all_time":
      return "Everything you have tracked";
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

/**
 * The live streak's inclusive day range, anchored on the last active day rather than
 * `anchor`: a run that ended yesterday still counts, as today isn't over. `null` without a live run.
 */
export function streakSpan(
  anchor: number,
  active: readonly number[],
  streakDays: number,
): [number, number] | null {
  const behind = active.filter((n) => n <= anchor);
  if (streakDays <= 0 || behind.length === 0) return null;
  const last = Math.max(...behind);
  return [last - (streakDays - 1), last];
}

/**
 * How far through its year `asOfDay` is, 0 to 1: the pace an annual target is read against.
 * `null` for a day the server never sent.
 */
export function yearFraction(asOfDay: string): number | null {
  const today = dayNumber(asOfDay);
  if (today === null) return null;
  const [year] = civilFromDays(today);
  const start = daysFromCivil(year, 1, 1);
  return (today - start + 1) / (daysFromCivil(year + 1, 1, 1) - start);
}
