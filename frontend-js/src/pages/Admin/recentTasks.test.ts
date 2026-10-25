import { describe, expect, it } from "vitest";
import { fmtDuration, recordKindLabel } from "./recentTasks";

describe("recordKindLabel", () => {
  it.each([
    ["scan", "Library scan"],
    ["scan_audiobooks", "Audiobook library scan"],
    ["generate_thumbs", "Thumbnail generation"],
    ["resolve_author_photo", "Author photo lookup"],
    ["hls_transcode", "Audio transcode for streaming"],
    ["refetch_author_photos", "Author photo refetch"],
    ["backfill_chapters", "Audiobook chapter extraction"],
    ["backfill_word_counts", "Word count backfill"],
    ["backfill_page_counts", "Page count backfill"],
    ["backfill_partial_md5", "Book fingerprint backfill"],
    ["backfill_epub_structure", "EPUB structure backfill"],
    ["backfill_covers", "Cover backfill"],
    ["backfill_thumbs", "Thumbnail backfill"],
    ["backfill_content_fts", "Book text indexing"],
    ["rebuild_fts_index", "Search index rebuild"],
    ["resolve_suggestions", "Suggestion lookup"],
    ["kepub_convert", "Kobo conversion"],
    ["convert_format", "Format conversion"],
    ["send_to_kindle", "Send to Kindle"],
    ["rewrite_all_epubs", "EPUB override bake"],
    ["detect_cleanup", "Cleanup detection"],
  ])("names %s in words", (kind, label) => {
    expect(recordKindLabel(kind)).toBe(label);
  });

  it("spells out a kind it does not know", () => {
    expect(recordKindLabel("prune_old_things")).toBe("Prune old things");
  });
});

describe("fmtDuration", () => {
  it.each([
    ["seconds under a minute", 1_000, 1_045, "45s"],
    ["one second short of a minute", 0, 59, "59s"],
    ["exactly a minute", 0, 60, "1m 0s"],
    ["minutes and seconds", 0, 200, "3m 20s"],
    ["one second short of an hour", 0, 3_599, "59m 59s"],
    ["exactly an hour", 0, 3_600, "1h 0m"],
    ["hours and minutes, dropping the seconds", 0, 3_729, "1h 2m"],
    ["a finish before the start", 100, 50, "0s"],
  ])("reads %s", (_condition, started, finished, text) => {
    expect(fmtDuration({ startedAt: started, finishedAt: finished })).toBe(
      text,
    );
  });

  it.each([
    ["null", null],
    ["absent", undefined],
  ])("reads running… when the finish is %s", (_condition, finished) => {
    expect(fmtDuration({ startedAt: 1_000, finishedAt: finished })).toBe(
      "running…",
    );
  });
});
