import { type ExpectMutationOptions, post } from "../utils/api";

/** The admin endpoints that change a book's files. */
export const booksUrls = {
  deleteFiles: /\/api\/rpc\/books\/delete-files(?:\?|$)/,
};

/** The writes an admin makes through a book's "Delete files…" dialog. */
export const books = {
  deleteFiles: (): ExpectMutationOptions => post(booksUrls.deleteFiles),
};
