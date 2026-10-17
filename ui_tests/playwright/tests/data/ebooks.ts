/** One book in `GET /api/rpc/ebooks`, trimmed to what the specs read. */
export type LibraryBook = {
  title: string | null;
  unique_identifier: string | null;
  formats: string[];
};

/** The metadata overrides a spec saves; a field is absent unless it is set. */
export type MetadataOverrides = { subjects?: string[]; genres?: string[] };

/** One book in `GET /api/ebooks/{uuid}`; `genres` is absent while empty. */
export type EbookDetail = { genres?: string[]; subjects: string[] };
