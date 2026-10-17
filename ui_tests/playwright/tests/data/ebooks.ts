/** One book in `GET /api/rpc/ebooks`, trimmed to what the specs read. */
export type LibraryBook = {
  title: string | null;
  unique_identifier: string | null;
  formats: string[];
};

/** The metadata overrides a spec saves; a field is absent unless it is set. */
export type MetadataOverrides = { subjects?: string[]; genres?: string[] };

/** One file of a book, in the order the file picker lists them. */
export type BookFile = { id: number; format: string };

/** One book in `GET /api/ebooks/{uuid}`; empty lists are left out. */
export type EbookDetail = {
  genres?: string[];
  subjects: string[];
  book_files?: BookFile[];
};
