/** One book in `GET /api/ebooks`, trimmed to the author and series links. */
export type IndexedBook = {
  creators: { name: string; id: number | null }[];
  series: string | null;
  series_id: number | null;
};
