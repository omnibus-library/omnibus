import type { Request } from "@playwright/test";

/** One stored position, as `GET /api/progress/{uuid}` reports it. */
export interface ProgressRecord {
  format: "epub" | "audio";
  epub_cfi: string | null;
  audio_position_seconds: number | null;
  progress_percent: number | null;
  /** Where a percent-only epub row opens — read paths only, never stored. */
  derived_epub_cfi?: string;
  total_duration_seconds?: number;
  resolved?: {
    spine_index?: number;
    chapter_title?: string;
    chapter_ordinal?: number;
    chapters_total?: number;
    percent_through_chapter?: number;
    percent_through_book?: number;
    confidence: "high" | "low";
  };
}

/** Every position the signed-in reader holds in one book. */
export interface BookProgress {
  book_uuid: string;
  records: ProgressRecord[];
  furthest: "epub" | "audio" | null;
  linked?: boolean;
}

/** The body of `POST /api/progress`. */
export type ProgressUpdate = {
  book_uuid: string;
  format: "epub";
  progress_percent: number;
};

/** What a Kobo sends: a whole-book percent and no CFI. */
export function koboPosition(
  bookUuid: string,
  percent: number,
): ProgressUpdate {
  return { book_uuid: bookUuid, format: "epub", progress_percent: percent };
}

/** The CFI the reader saved, read off one of its progress-save requests. */
export function savedCfi(request: Request): string {
  const { update }: { update: { epub_cfi: string } } = request.postDataJSON();
  return update.epub_cfi;
}

/** The anchor the comic pager saves for the 0-based page `index`. */
export function comicPageAnchor(index: number): string {
  return `comic-page:${index}`;
}

/** The anchor the PDF reader saves for the 0-based page `index`. */
export function pdfPageAnchor(index: number): string {
  return `pdf-page:${index}`;
}

/** The whole-book percent a paged reader saves on page `index` of `pages`. */
export function pagePercent(index: number, pages: number): number {
  return Math.round(((index + 1) * 100) / pages);
}
