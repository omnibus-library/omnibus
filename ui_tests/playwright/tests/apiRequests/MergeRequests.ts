import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Merges two books into one and undoes it, as the admin who owns the context. */
export class MergeRequests extends BaseRequests {
  /** Folds the source book into the target; the body is a `MergeLog`. */
  postMerge(sourceUuid: string, targetUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/merge-books", {
      source_uuid: sourceUuid,
      target_uuid: targetUuid,
    });
  }

  postMergeUndo(mergeLogId: number): Promise<APIResponse> {
    return this.post("/api/rpc/merge-books/undo", { merge_log_id: mergeLogId });
  }
}
