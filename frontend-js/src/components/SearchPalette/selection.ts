import type { PaletteResults } from "../../api";
import { facetHref, SECTION_LABELS } from "../../search";
import { type SettingsEntry, sectionHref } from "../../settingsIndex";

/** One selectable palette row, carrying the hit it shows. */
export type PaletteItem =
  | { kind: "book"; hit: PaletteResults["books"][number] }
  | { kind: "author"; hit: PaletteResults["authors"][number] }
  | { kind: "series"; hit: PaletteResults["series"][number] }
  | { kind: "tag"; hit: PaletteResults["tags"][number] }
  | { kind: "genre"; hit: PaletteResults["genres"][number] }
  | { kind: "setting"; hit: SettingsEntry };

export type PaletteGroup = { label: string; items: PaletteItem[] };

/** The groups with hits, in render order: the server's, then the settings. */
export function paletteGroups(
  results: PaletteResults | undefined,
  settings: readonly SettingsEntry[],
): PaletteGroup[] {
  const server: PaletteGroup[] = results
    ? [
        {
          label: SECTION_LABELS.books,
          items: results.books.map((hit) => ({ kind: "book", hit })),
        },
        {
          label: SECTION_LABELS.authors,
          items: results.authors.map((hit) => ({ kind: "author", hit })),
        },
        {
          label: SECTION_LABELS.series,
          items: results.series.map((hit) => ({ kind: "series", hit })),
        },
        {
          label: SECTION_LABELS.tags,
          items: results.tags.map((hit) => ({ kind: "tag", hit })),
        },
        {
          label: SECTION_LABELS.genres,
          items: results.genres.map((hit) => ({ kind: "genre", hit })),
        },
      ]
    : [];
  const all = [
    ...server,
    {
      label: "Settings",
      items: settings.map((hit) => ({ kind: "setting" as const, hit })),
    },
  ];
  return all.filter((group) => group.items.length > 0);
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
      return `book:${item.hit.uuid}`;
    case "author":
    case "series":
    case "tag":
      return `${item.kind}:${item.hit.id}`;
    case "genre":
      return `genre:${item.hit.name}`;
    case "setting":
      return `setting:${item.hit.label}`;
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
      return `/books/${item.hit.uuid}`;
    case "author":
      return `/authors/${item.hit.id}`;
    case "series":
      return `/series/${item.hit.id}`;
    case "tag":
    case "genre":
      return facetHref(item.kind, item.hit.name);
    case "setting":
      return sectionHref(item.hit.section);
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}
