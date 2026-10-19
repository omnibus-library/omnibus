import type { ResumePoint } from "./api";

/** Where a "Continue" link resumes: the player at its file, or a reader. */
export function resumeHref(point: ResumePoint): string {
  const uuid = point.book.uuid;
  const has = (format: string) =>
    point.formats.some((f) => f.toLowerCase() === format);
  if (point.format === "audio") {
    const file = point.fileId === null ? "" : `?file_id=${point.fileId}`;
    return `/listen/${uuid}${file}`;
  }
  // EPUB > CBZ > PDF: comics and PDFs share the epub progress lane.
  if (has("epub")) return `/read/${uuid}`;
  if (has("cbz")) return `/comic/${uuid}`;
  if (has("pdf")) return `/pdf/${uuid}`;
  return `/read/${uuid}`;
}
