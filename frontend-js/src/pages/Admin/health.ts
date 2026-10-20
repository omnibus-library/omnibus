import { bookCount, fileSize } from "../../format";

/** A run's time: milliseconds under a second, tenths of a second past it. */
export function formatDurationMs(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/** A byte count where zero is a real figure, as an empty cache is. */
export const formatBytes = (n: number) => fileSize(n) ?? "0 B";

/** "12.3 MB / 5.0 GB cap". */
export const formatCacheUsage = (used: number, cap: number) =>
  `${formatBytes(used)} / ${formatBytes(cap)} cap`;

/** How many books have lost their files, agreeing with the count. */
export const ghostedLine = (count: number) =>
  `${bookCount(count)} ${count === 1 ? "has" : "have"} no file on disk (ghosted by a prior reindex).`;

/** A library folder as the report names it; a blank one is not set. */
export const pathOrUnconfigured = (path: string | null | undefined) =>
  path?.trim() ? path : "Not configured";
