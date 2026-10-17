import type { APIRequestContext } from "@playwright/test";
import type { BookProgress, ProgressRecord } from "../data/progress";

/**
 * The reader's stored position in one format, or `null` when they have none.
 *
 * The endpoint answers with an envelope over every format — `?format=` narrows
 * `records` rather than changing the shape — so a spec that wants one side
 * still has to reach through it.
 */
export async function storedProgress(
  request: APIRequestContext,
  uuid: string,
  format: "epub" | "audio" = "epub",
): Promise<ProgressRecord | null> {
  const res = await request.get(`/api/progress/${uuid}?format=${format}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as BookProgress | null;
  return body?.records.find((r) => r.format === format) ?? null;
}
