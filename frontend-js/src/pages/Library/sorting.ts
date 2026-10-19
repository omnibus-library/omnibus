import type { SortDir, SortKey } from "../../api";

/** The sort axes the toolbar offers, in display order. */
export const SORT_KEYS: SortKey[] = [
  "title",
  "author",
  "series",
  "recently_interacted",
  "last_updated",
  "newest_added",
];

const LABELS: Record<SortKey, string> = {
  title: "Title",
  author: "Author",
  series: "Series",
  last_updated: "Last Updated",
  newest_added: "Newest Added",
  recently_interacted: "Recently Interacted",
};

export const sortLabel = (key: SortKey) => LABELS[key];

/** The direction a freshly picked axis starts in: newest first for the recency keys. */
export function defaultDirFor(key: SortKey): SortDir {
  return key === "newest_added" ||
    key === "last_updated" ||
    key === "recently_interacted"
    ? "desc"
    : "asc";
}

export const toggleDir = (dir: SortDir): SortDir =>
  dir === "asc" ? "desc" : "asc";
