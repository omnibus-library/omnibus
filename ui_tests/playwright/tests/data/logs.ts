/** One server log record, as the log viewer lists it. */
export type LogRecord = {
  level: string;
  target: string;
  message: string;
};

/** The `LogPage` body `POST /api/rpc/logs` answers with. */
export type LogPage = {
  records: (LogRecord & { timestamp: string })[];
  page: number;
  per_page: number;
  has_more: boolean;
};

/** The fields of a log query a test asserts on. */
export type LogQuery = { level?: string; module?: string; page?: number };

/** A page of `records`, stamped a second apart so their order is fixed. */
export function buildLogPage(
  records: LogRecord[],
  { page = 0, hasMore = false } = {},
): LogPage {
  return {
    records: records.map((record, i) => ({
      timestamp: `2026-07-19T08:00:0${i}.000000Z`,
      ...record,
    })),
    page,
    per_page: 50,
    has_more: hasMore,
  };
}
