import { noneIfBlank } from "../../format";

/**
 * A `datetime-local` value (the admin's wall clock) as the UTC minute the server's
 * `…Z` timestamps are compared on, or null when it is blank or not a date.
 * Minute precision is deliberate: an upper bound then takes in its whole minute.
 */
export function localToUtcPrefix(value: string): string | null {
  const trimmed = noneIfBlank(value);
  if (trimmed === null) return null;
  // A date-time with no zone parses as local time.
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 16);
}
