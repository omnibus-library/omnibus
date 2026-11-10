/** The element a query found, or a throw naming what was missing, so a renamed selector fails by name rather than as a number mismatch. */
export function found<T extends Element>(
  el: T | null | undefined,
  what: string,
): T {
  if (!el) throw new Error(`${what} is missing`);
  return el;
}
