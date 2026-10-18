/** A book as the detail endpoint returns it, trimmed to what the specs read. */
export type OverriddenBook = {
  genres?: string[];
  subjects: string[];
  [field: string]: unknown;
};
