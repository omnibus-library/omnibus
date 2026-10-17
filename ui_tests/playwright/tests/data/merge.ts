/** What `merge-books` answers with: the handle that undoes the merge. */
export type MergeLog = { merge_log_id: number };

/** The merged audiobook, and the ids of its audio files in picker order. */
export type MergedAudiobook = { uuid: string; audioFileIds: number[] };
