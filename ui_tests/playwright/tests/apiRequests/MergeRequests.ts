import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Book merges, which are library-wide state; needs an admin's context. */
export class MergeRequests extends BaseRequests {
  /** Returns `{ merge_log_id }`, the handle `postUndo` takes. */
  postMerge(sourceUuid: string, targetUuid: string): Promise<APIResponse> {
    return this.post("/api/rpc/merge-books", {
      source_uuid: sourceUuid,
      target_uuid: targetUuid,
    });
  }

  postUndo(mergeLogId: number): Promise<APIResponse> {
    return this.post("/api/rpc/merge-books/undo", { merge_log_id: mergeLogId });
  }
}
