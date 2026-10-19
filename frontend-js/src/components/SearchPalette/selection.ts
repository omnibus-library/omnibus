import type { AuthorId, BookUuid, PaletteResults, SeriesId } from "../../api";
import { facetQuery } from "../../format";
import { type SettingsEntry, settingsHref } from "../../settingsIndex";

/** One selectable palette row; arrow keys walk a single list of them. */
export type PaletteItem =
  | { kind: "book"; uuid: BookUuid; title: string }
  | { kind: "author"; id: AuthorId; name: string }
  | { kind: "series"; id: SeriesId; name: string }
  | { kind: "tag"; id: number; name: string }
  | { kind: "genre"; name: string }
  | { kind: "setting"; entry: SettingsEntry };

/** Every row in render order: the server's groups, then the settings. */
export function paletteItems(
  results: PaletteResults | undefined,
  settings: readonly SettingsEntry[],
): PaletteItem[] {
  const server: PaletteItem[] = results
    ? [
        ...results.books.map((b) => ({
          kind: "book" as const,
          uuid: b.uuid,
          title: b.title,
        })),
        ...results.authors.map((a) => ({
          kind: "author" as const,
          id: a.id,
          name: a.name,
        })),
        ...results.series.map((s) => ({
          kind: "series" as const,
          id: s.id,
          name: s.name,
        })),
        ...results.tags.map((t) => ({
          kind: "tag" as const,
          id: t.id,
          name: t.name,
        })),
        ...results.genres.map((g) => ({
          kind: "genre" as const,
          name: g.name,
        })),
      ]
    : [];
  return [
    ...server,
    ...settings.map((entry) => ({ kind: "setting" as const, entry })),
  ];
}

/** The highlight after an arrow key; `null` means nothing is highlighted yet. */
export function moveSelection(
  selected: number | null,
  length: number,
  direction: "up" | "down",
): number | null {
  if (length === 0) return selected;
  // The first press starts navigating at an end rather than stepping past it.
  if (selected === null) return direction === "down" ? 0 : length - 1;
  const step = direction === "down" ? 1 : -1;
  return (selected + step + length) % length;
}

/** A stable identity for a row, so the highlight can follow it. */
export function itemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "book":
      return `book:${item.uuid}`;
    case "author":
    case "series":
    case "tag":
      return `${item.kind}:${item.id}`;
    case "genre":
      return `genre:${item.name}`;
    case "setting":
      return `setting:${item.entry.label}`;
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

/** The highlighted row's position; the top when it has left the list. */
export function selectedIndex(
  items: readonly PaletteItem[],
  key: string,
): number {
  return Math.max(
    items.findIndex((item) => itemKey(item) === key),
    0,
  );
}

/** Where a row opens: its detail page, a facet search, or a settings section. */
export function itemHref(item: PaletteItem): string {
  switch (item.kind) {
    case "book":
      return `/books/${item.uuid}`;
    case "author":
      return `/authors/${item.id}`;
    case "series":
      return `/series/${item.id}`;
    case "tag":
    case "genre":
      return searchHref(facetQuery(item.kind, item.name));
    case "setting":
      return settingsHref(item.entry);
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

/** The full results page for `query`. */
export const searchHref = (query: string) =>
  `/search/${encodeURIComponent(query)}`;
