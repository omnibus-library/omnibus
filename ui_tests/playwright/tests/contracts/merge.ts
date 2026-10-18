import type { ExpectMutationOptions } from "../utils/api";

/** The merge endpoints; `books` excludes the `/undo` suffix. */
export const mergeUrls = {
  books: /\/api\/rpc\/merge-books(?:\?|$)/,
  undo: /\/api\/rpc\/merge-books\/undo(?:\?|$)/,
};

function mergeWrite(url: RegExp, body?: unknown): ExpectMutationOptions {
  return { method: "POST", url, expectedBody: body, expectedStatus: 200 };
}

/** The writes an admin makes to merge two books and take it back. */
export const merge = {
  books: (body?: {
    source_uuid: string;
    target_uuid: string;
  }): ExpectMutationOptions => mergeWrite(mergeUrls.books, body),

  undo: (body?: { merge_log_id: number }): ExpectMutationOptions =>
    mergeWrite(mergeUrls.undo, body),
};
