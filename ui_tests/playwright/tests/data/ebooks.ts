/** One book in `GET /api/rpc/ebooks`, trimmed to what the specs read. */
export type LibraryBook = {
  title: string | null;
  unique_identifier: string | null;
  formats: string[];
};
