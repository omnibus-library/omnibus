/** One book in `GET /api/rpc/ebooks`, trimmed to what the specs read. */
export type LibraryBook = {
  title: string | null;
  unique_identifier: string | null;
  formats: string[];
};

// batch-D: a book a delete test uploads for itself
/** An EPUB uploaded for a delete test, and the folder it was filed under. */
export type UploadedEbook = { uuid: string; folder: string };
