import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { ok } from "./core";
import { getAdminHealth, getLogs } from "./generated/omnibus";
import type { GetLogsParams } from "./generated/schemas";

export type {
  AdminHealthReport,
  CapturedError,
  LogRecord,
  WorkerQueueEntry,
} from "./generated/schemas";

/** The server's health report, read every 5 s while a screen shows it. */
export const adminHealthQuery = queryOptions({
  queryKey: ["admin", "health"],
  queryFn: async () => ok(await getAdminHealth()),
  refetchInterval: 5_000,
});

/** What the log viewer asks for: a null filter is left off. */
export type LogQuery = {
  [K in "level" | "module" | "from" | "to"]: NonNullable<
    GetLogsParams[K]
  > | null;
} & { page: NonNullable<GetLogsParams["page"]> };

/** One page of the server's log records, newest first; the page on screen stays until the next lands. */
export const logsQuery = (query: LogQuery) =>
  queryOptions({
    queryKey: ["admin", "logs", query],
    queryFn: async () =>
      ok(
        await getLogs({
          level: query.level ?? undefined,
          module: query.module ?? undefined,
          from: query.from ?? undefined,
          to: query.to ?? undefined,
          page: query.page,
        }),
      ),
    placeholderData: keepPreviousData,
  });
