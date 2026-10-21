import { queryOptions } from "@tanstack/react-query";
import { fetchPalette } from "./api";
import { facetQuery } from "./format";

/** One search's grouped hits; the palette and the results page share the cache. */
export const paletteQuery = (query: string) =>
  queryOptions({
    queryKey: ["palette", query],
    queryFn: ({ signal }) => fetchPalette(query, { signal }),
  });

/** The groups a search answers with, in their default order. */
export const SECTIONS = [
  "books",
  "authors",
  "series",
  "tags",
  "genres",
] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  books: "Books",
  authors: "Authors",
  series: "Series",
  tags: "Tags",
  genres: "Genres",
};

/** The full results page for `query`. */
export const searchHref = (query: string) =>
  `/search/${encodeURIComponent(query)}`;

/** The results page narrowed to one tag or genre. */
export const facetHref = (facet: "tag" | "genre", name: string) =>
  searchHref(facetQuery(facet, name));
