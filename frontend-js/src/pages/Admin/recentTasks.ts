import { finishedKindLabel } from "../../components/WorkerStatus/workerLines";
import { capitalize } from "../../format";

// Kinds the worker line names come from `finishedKindLabel`, so each label is written once.
const KIND_LABELS = new Map([
  ["scan_audiobooks", "Audiobook library scan"],
  ["hls_transcode", "Audio transcode for streaming"],
  ["backfill_word_counts", "Word count backfill"],
  ["backfill_page_counts", "Page count backfill"],
  ["backfill_partial_md5", "Book fingerprint backfill"],
  ["backfill_epub_structure", "EPUB structure backfill"],
  ["backfill_covers", "Cover backfill"],
  ["backfill_thumbs", "Thumbnail backfill"],
  ["backfill_content_fts", "Book text indexing"],
  ["rebuild_fts_index", "Search index rebuild"],
  ["kepub_convert", "Kobo conversion"],
  ["convert_format", "Format conversion"],
  ["send_to_kindle", "Send to Kindle"],
  ["rewrite_all_epubs", "EPUB override bake"],
  ["detect_cleanup", "Cleanup detection"],
]);

/** A recorded run's kind in words; a kind this build doesn't know is spelled out from its name. */
export function recordKindLabel(kind: string): string {
  return (
    finishedKindLabel(kind) ??
    KIND_LABELS.get(kind) ??
    capitalize(kind.replaceAll("_", " "))
  );
}

/** Time between a run's start and finish in its two largest units ("45s", "3m 20s", "1h 2m"), or "running…". */
export function fmtDuration({
  startedAt,
  finishedAt,
}: {
  startedAt: number;
  finishedAt: number | null | undefined;
}): string {
  if (finishedAt == null) return "running…";
  const secs = Math.max(0, finishedAt - startedAt);
  const [h, m, s] = [
    Math.floor(secs / 3600),
    Math.floor((secs % 3600) / 60),
    secs % 60,
  ];
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
