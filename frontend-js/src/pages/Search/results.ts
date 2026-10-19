import type { PaletteResults } from "../../api";
import { SECTIONS, type Section } from "../../search";

/** A run of a result's text, and whether it is the searched-for term. */
export type HighlightPart = { text: string; hit: boolean };

/** Splits `text` around every case-insensitive occurrence of `query`. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = Array.from(query.toLowerCase());
  if (needle.length === 0) return [{ text, hit: false }];
  const chars = Array.from(text);
  // Per character, so a lowercasing that changes length can't shift the slice.
  const lower = chars.map((c) => Array.from(c.toLowerCase())[0] ?? c);
  const parts: HighlightPart[] = [];
  let plain = "";
  let i = 0;
  while (i < chars.length) {
    if (needle.every((c, j) => lower[i + j] === c)) {
      if (plain) parts.push({ text: plain, hit: false });
      plain = "";
      parts.push({
        text: chars.slice(i, i + needle.length).join(""),
        hit: true,
      });
      i += needle.length;
    } else {
      plain += chars[i];
      i += 1;
    }
  }
  if (plain) parts.push({ text: plain, hit: false });
  return parts;
}

const NOUNS: Record<Section, [one: string, many: string]> = {
  books: ["title", "titles"],
  authors: ["author", "authors"],
  series: ["series", "series"],
  tags: ["tag", "tags"],
  genres: ["genre", "genres"],
};

/** "3 titles · 1 author · fts5 · 24ms": the true totals, then the engine and time. */
export function summaryLine(results: PaletteResults): string {
  const counts = SECTIONS.filter((s) => results.totals[s] > 0).map((s) => {
    const n = results.totals[s];
    const [one, many] = NOUNS[s];
    return `${n} ${n === 1 ? one : many}`;
  });
  return [...counts, "fts5", `${results.durationMs}ms`].join(" · ");
}

/** Whether the query names a tag, which moves the tags to the top. */
export function matchesTag(results: PaletteResults, query: string): boolean {
  const q = query.toLowerCase();
  return results.tags.some((t) => t.name.toLowerCase().includes(q));
}

/** The groups with hits, tags first when the query names a tag. */
export function sectionOrder(
  results: PaletteResults,
  query: string,
): Section[] {
  const order: readonly Section[] = matchesTag(results, query)
    ? ["tags", "books", "authors", "series", "genres"]
    : SECTIONS;
  return order.filter((s) => results.totals[s] > 0);
}

/** The note under an opened group the server still cut short, else `null`. */
export function cutNote(
  section: Section,
  results: PaletteResults,
): string | null {
  const fetched = results[section].length;
  const total = results.totals[section];
  return fetched < total
    ? `Showing the first ${fetched} of ${total} — narrow your search to see the rest.`
    : null;
}
