import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type LogQuery, type LogRecord, logsQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, RowSkeletons } from "../../components/Loading/Loading";
import { localToUtcPrefix, noneIfBlank } from "./logs";

const FIRST_PAGE: LogQuery = {
  level: null,
  module: null,
  from: null,
  to: null,
  page: 0,
};

// Spelled out, not built from the level, so the CSS extractor sees each class.
const LEVEL_CLASSES = new Map([
  ["ERROR", "logs-level logs-level-error"],
  ["WARN", "logs-level logs-level-warn"],
  ["INFO", "logs-level logs-level-info"],
  ["DEBUG", "logs-level logs-level-debug"],
  ["TRACE", "logs-level logs-level-trace"],
]);

type Filters = { level: string; module: string; from: string; to: string };

function FilterBar({
  filters,
  onChange,
  onApply,
}: {
  filters: Filters;
  onChange: (change: Partial<Filters>) => void;
  onApply: () => void;
}) {
  return (
    <div className="logs-filters">
      <div className="settings-field">
        <label htmlFor="logs-level">Level</label>
        <select
          id="logs-level"
          data-testid="logs-level"
          value={filters.level}
          onChange={(e) => onChange({ level: e.target.value })}
        >
          <option value="">All levels</option>
          <option value="ERROR">Error</option>
          <option value="WARN">Warn</option>
          <option value="INFO">Info</option>
          <option value="DEBUG">Debug</option>
          <option value="TRACE">Trace</option>
        </select>
      </div>
      <div className="settings-field">
        <label htmlFor="logs-module">Module</label>
        <input
          type="text"
          id="logs-module"
          data-testid="logs-module"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. omnibus::backend…"
          value={filters.module}
          onChange={(e) => onChange({ module: e.target.value })}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="logs-from">From</label>
        <input
          type="datetime-local"
          id="logs-from"
          data-testid="logs-from"
          value={filters.from}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="logs-to">To</label>
        <input
          type="datetime-local"
          id="logs-to"
          data-testid="logs-to"
          value={filters.to}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </div>
      <div className="settings-actions logs-apply">
        <Button data-testid="logs-apply" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function LogLine({ record }: { record: LogRecord }) {
  return (
    <div className="logs-line" data-testid="logs-row">
      <span className="logs-time">{record.timestamp}</span>{" "}
      <span className={LEVEL_CLASSES.get(record.level) ?? "logs-level"}>
        {record.level}
      </span>{" "}
      <span className="logs-module-cell">{record.target}</span>{" "}
      <span className="logs-message">{record.message}</span>
      {record.fields != null && (
        <>
          {" "}
          <span className="logs-fields">{record.fields}</span>
        </>
      )}
    </div>
  );
}

/** Newer and Older, with the page between; only the button last clicked shows its page coming in. */
function Pagination({
  page,
  hasMore,
  loading,
  heading,
  onGo,
}: {
  page: number;
  hasMore: boolean;
  loading: boolean;
  heading: "newer" | "older" | null;
  onGo: (to: "newer" | "older") => void;
}) {
  const newerBusy = loading && heading === "newer";
  const olderBusy = loading && heading === "older";
  return (
    <div className="logs-pagination">
      <Button
        variant="ghost"
        data-testid="logs-prev"
        disabled={page === 0 || loading}
        aria-busy={newerBusy}
        onClick={() => onGo("newer")}
      >
        <BusyLabel busy={newerBusy} label="Newer" busyLabel="Loading…" />
      </Button>
      <span
        className="logs-page-indicator mono"
        data-testid="logs-page-indicator"
      >
        Page {page + 1}
      </span>
      <Button
        variant="ghost"
        data-testid="logs-next"
        disabled={!hasMore || loading}
        aria-busy={olderBusy}
        onClick={() => onGo("older")}
      >
        <BusyLabel busy={olderBusy} label="Older" busyLabel="Loading…" />
      </Button>
    </div>
  );
}

/** The server's on-disk logs, newest first, narrowed by level, module and time range. */
export function LogsSection() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    level: "",
    module: "",
    from: "",
    to: "",
  });
  // Typing only edits `filters`; Apply copies them here, which is what the page reads.
  const [applied, setApplied] = useState(FIRST_PAGE);
  const [heading, setHeading] = useState<"newer" | "older" | null>(null);
  const logs = useQuery(logsQuery(applied));
  const loading = logs.isFetching;

  useEffect(() => {
    if (!loading) setHeading(null);
  }, [loading]);

  const apply = () => {
    const next: LogQuery = {
      level: noneIfBlank(filters.level),
      module: noneIfBlank(filters.module),
      from: localToUtcPrefix(filters.from),
      to: localToUtcPrefix(filters.to),
      page: 0,
    };
    setApplied(next);
    // Applying what is already showing still reads the logs again.
    void queryClient.invalidateQueries({ queryKey: logsQuery(next).queryKey });
  };

  const go = (to: "newer" | "older") => {
    setHeading(to);
    setApplied({ ...applied, page: applied.page + (to === "older" ? 1 : -1) });
  };

  const page = logs.data;
  return (
    <div className="logs-page" data-testid="logs-page">
      <section className="card">
        <h3>Server logs</h3>
        <p className="subtitle">
          Browse the on-disk structured logs, newest first.
        </p>
        <FilterBar
          filters={filters}
          onChange={(change) => setFilters({ ...filters, ...change })}
          onApply={apply}
        />
        {page === undefined ? (
          logs.isError ? (
            <div className="settings-actions">
              <p
                className="settings-status error"
                role="status"
                data-testid="logs-error"
              >
                Couldn’t load the logs.
              </p>
              <Button
                variant="ghost"
                data-testid="logs-retry"
                onClick={() => logs.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <div role="status" aria-live="polite" data-testid="logs-loading">
              <span className="ld-sr">Reading the logs</span>
              <RowSkeletons count={6} avatar={false} />
            </div>
          )
        ) : page.records.length === 0 ? (
          <p className="settings-status" role="status" data-testid="logs-empty">
            No log records match these filters.
          </p>
        ) : (
          <>
            <section
              className="logs-stream mono"
              data-testid="logs-table"
              aria-label="Server log stream"
            >
              {page.records.map((record, i) => (
                <LogLine
                  // biome-ignore lint/suspicious/noArrayIndexKey: records share a timestamp and have no id
                  key={`${record.timestamp}-${i}`}
                  record={record}
                />
              ))}
            </section>
            <Pagination
              page={applied.page}
              hasMore={page.has_more}
              loading={loading}
              heading={heading}
              onGo={go}
            />
          </>
        )}
      </section>
    </div>
  );
}
