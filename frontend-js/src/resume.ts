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

/** `7h 50m` / `50m` for a span of remaining seconds. */
export function formatHmLeft(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
    : `${minutes}m`;
}

/** `H:MM:SS` (or `M:SS`) for an absolute position. */
export function formatHmsShort(seconds: number): string {
  const whole =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mm = Math.floor((whole % 3600) / 60);
  const ss = String(whole % 60).padStart(2, "0");
  return whole >= 3600
    ? `${Math.floor(whole / 3600)}:${String(mm).padStart(2, "0")}:${ss}`
    : `${mm}:${ss}`;
}

/**
 * The meta line and bar fill of a resume point. A chapter reads as one, the
 * container's marks as a part; time left is wall-clock at the saved rate.
 */
export function resumeMeta(point: ResumePoint): {
  meta: string;
  percent: number | null;
} {
  if (point.format !== "audio") {
    return point.percent === null
      ? { meta: "Continue reading", percent: null }
      : {
          meta: `${point.percent}% · Continue reading`,
          percent: point.percent,
        };
  }
  const position = point.positionSeconds ?? 0;
  const total = point.totalSeconds;
  if (total === null || total <= 0) {
    return { meta: `${formatHmsShort(position)} in`, percent: null };
  }
  const percent = Math.round(Math.min(Math.max(position / total, 0), 1) * 100);
  const rate = point.playbackRate ?? 1;
  const left = Math.max(total - position, 0) / (rate > 0 ? rate : 1);
  const where =
    point.chapter !== null
      ? `Ch. ${point.chapter} · `
      : point.part !== null
        ? `Pt. ${point.part} · `
        : "";
  return {
    meta: `${where}${percent}% · ${formatHmLeft(left)} left`,
    percent,
  };
}
