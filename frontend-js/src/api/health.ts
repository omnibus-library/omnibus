import { queryOptions } from "@tanstack/react-query";
import { ok } from "./core";
import { getAdminHealth } from "./generated/omnibus";

export type {
  AdminHealthReport,
  CapturedError,
  WorkerQueueEntry,
} from "./generated/schemas";

/** The server's health report, read every 5 s while a screen shows it. */
export const adminHealthQuery = queryOptions({
  queryKey: ["admin", "health"],
  queryFn: async () => ok(await getAdminHealth()),
  refetchInterval: 5_000,
});
