import type { BookDetail } from "./books";
import { toBookDetail } from "./books";
import type { BookUuid } from "./core";
import { failure, ok } from "./core";
import {
  getDeletionManifest,
  getKindleSendStatus,
  getMergeCandidates,
  mergeBooks,
  postDeleteBookFiles,
  undoMerge as postUndoMerge,
  sendToKindle,
} from "./generated/omnibus";
import type { BookDeletionManifest as BookDeletionManifestWire } from "./generated/schemas";
import { toCopy } from "./physical";

/** Queues the email of a book's EPUB (else PDF), or of one of its files; answers the task to poll. */
export async function enqueueKindleSend(
  uuid: BookUuid,
  fileId: number | null,
): Promise<number> {
  return ok(await sendToKindle({ book_uuid: uuid, file_id: fileId })).task_id;
}

/** Where a send stands; `unknown` is a task the server has forgotten, so its delivery is unconfirmed. */
export type KindleSend =
  | { status: "pending" | "sent" | "unknown" }
  | { status: "failed"; message: string };

export async function fetchKindleSend(
  taskId: number,
  signal?: AbortSignal,
): Promise<KindleSend> {
  const res = await getKindleSendStatus({ task_id: taskId }, { signal });
  if (res.status === 404) return { status: "unknown" };
  if (res.status !== 200) throw failure(res);
  return res.data;
}

/** Books to merge into this one, matched on title, author or series; ebooks and audiobooks alike. */
export async function fetchMergeCandidates(q: string): Promise<BookDetail[]> {
  return ok(await getMergeCandidates({ q })).map(toBookDetail);
}

/** Folds `source` into `target`; answers the id that undoes it. */
export async function mergeBooksInto(
  source: BookUuid,
  target: BookUuid,
): Promise<number> {
  return ok(await mergeBooks({ source_uuid: source, target_uuid: target }))
    .merge_log_id;
}

export async function undoBookMerge(logId: number): Promise<void> {
  ok(await postUndoMerge({ merge_log_id: logId }));
}

function toManifest(wire: BookDeletionManifestWire) {
  return {
    files: wire.files.map((f) => ({
      id: f.id,
      format: f.format,
      label: f.label ?? null,
      filename: f.filename,
      sizeBytes: f.size_bytes ?? 0,
      path: f.path ?? null,
    })),
    copies: wire.copies.map(toCopy),
    impact: wire.impact,
  };
}

export type DeletionManifest = ReturnType<typeof toManifest>;

/** What an admin can delete of a book, and the reader data at stake. */
export async function fetchDeletionManifest(
  uuid: BookUuid,
): Promise<DeletionManifest> {
  return toManifest(ok(await getDeletionManifest(encodeURIComponent(uuid))));
}

/** Deletes files and copies; `bookDeleted` is true when nothing of the book was left. */
export async function deleteBookFiles(
  uuid: BookUuid,
  fileIds: number[],
  copyIds: number[],
): Promise<{ bookDeleted: boolean }> {
  return {
    bookDeleted: ok(
      await postDeleteBookFiles(encodeURIComponent(uuid), {
        file_ids: fileIds,
        copy_ids: copyIds,
      }),
    ).book_deleted,
  };
}
