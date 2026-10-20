import { FORMATS } from "../../components/FilterBar/filters";

/** `hidden` with `fmt` hidden (`on`) or shown, sorted and without repeats. */
export function withFormat(
  hidden: readonly string[],
  fmt: string,
  on: boolean,
): string[] {
  const set = new Set(hidden);
  if (on) set.add(fmt);
  else set.delete(fmt);
  return [...set].sort();
}

/** The checkboxes to draw: every known format, then any saved one the list doesn't know, so it can always be shown again. */
export function formatOptions(hidden: readonly string[]): string[] {
  return [...FORMATS, ...hidden.filter((fmt) => !FORMATS.includes(fmt))];
}
