import { type ExpectMutationOptions, post } from "../utils/api";

/** The merge endpoints; `books` excludes the `/undo` suffix. */
export const mergeUrls = {
  books: /\/api\/rpc\/merge-books(?:\?|$)/,
  undo: /\/api\/rpc\/merge-books\/undo(?:\?|$)/,
};

/** What a merge answers with: the log id that `merge.undo` takes back. */
export type MergeResult = { merge_log_id: number; target_uuid: string };

/** The writes an admin makes to merge two books and take it back. */
export const merge = {
  books: (body?: {
    source_uuid: string;
    target_uuid: string;
  }): ExpectMutationOptions => post(mergeUrls.books, body),

  undo: (body?: { merge_log_id: number }): ExpectMutationOptions =>
    post(mergeUrls.undo, body),
};
