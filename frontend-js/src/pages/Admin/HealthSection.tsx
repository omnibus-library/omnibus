import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  type AdminHealthReport,
  adminHealthQuery,
  type CapturedError,
  type WorkerQueueEntry,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { workerKindLabel } from "../../components/WorkerStatus/workerLines";
import { formatUtcTimestamp } from "../../format";
import {
  formatBytes,
  formatCacheUsage,
  formatDurationMs,
  ghostedLine,
  pathOrUnconfigured,
} from "./health";

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ah-kv-row">
      <span className="ah-kv-label">{label}</span>
      <span className="ah-kv-value">{value}</span>
    </div>
  );
}

function IndexStatusCard({ status }: { status: AdminHealthReport["index"] }) {
  return (
    <section className="card ah-card" data-testid="admin-health-index-card">
      <h3>Index status</h3>
      <div className="ah-kv">
        <KvRow
          label="Ebook library"
          value={pathOrUnconfigured(status.ebook_library_path)}
        />
        <KvRow
          label="Audiobook library"
          value={pathOrUnconfigured(status.audiobook_library_path)}
        />
        <KvRow label="Books indexed" value={String(status.book_count)} />
        <KvRow label="Authors indexed" value={String(status.author_count)} />
        <KvRow label="Series indexed" value={String(status.series_count)} />
      </div>
      {status.ghosted_book_count > 0 ? (
        <p
          className="settings-status error"
          data-testid="admin-health-ghosted-warning"
        >
          {ghostedLine(status.ghosted_book_count)}
        </p>
      ) : (
        <p
          className="settings-status success"
          data-testid="admin-health-ghosted-ok"
        >
          No ghosted books.
        </p>
      )}
    </section>
  );
}

function WorkerQueueRow({ entry }: { entry: WorkerQueueEntry }) {
  const last = entry.recent_completions_ms.at(-1);
  return (
    <tr data-testid="admin-health-worker-row">
      <td>{workerKindLabel(entry.kind, entry.queue_depth > 0)}</td>
      <td className="ah-num">{entry.queue_depth}</td>
      <td className="ah-num">{entry.recent_completions_ms.length}</td>
      <td className="ah-num">
        {last === undefined ? "—" : formatDurationMs(last)}
      </td>
    </tr>
  );
}

function WorkerQueueCard({ entries }: { entries: WorkerQueueEntry[] }) {
  return (
    <section className="card ah-card" data-testid="admin-health-worker-card">
      <h3>Worker queue</h3>
      {entries.length === 0 ? (
        <p className="settings-status" data-testid="admin-health-worker-empty">
          No active or recently completed background tasks.
        </p>
      ) : (
        <div className="table-scroll">
          <table
            className="users-table"
            data-testid="admin-health-worker-table"
          >
            <thead>
              <tr>
                <th>Task</th>
                <th className="ah-num">Queued</th>
                <th className="ah-num">Done recently</th>
                <th className="ah-num">Last took</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <WorkerQueueRow key={entry.kind} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FtsHealthCard({ fts }: { fts: AdminHealthReport["fts"] }) {
  return (
    <section className="card ah-card" data-testid="admin-health-fts-card">
      <h3>Search index (FTS)</h3>
      <div className="ah-kv">
        <KvRow label="Books rows" value={String(fts.books_rows)} />
        <KvRow label="FTS rows" value={String(fts.fts_rows)} />
      </div>
      {fts.in_sync ? (
        <p
          className="settings-status success"
          data-testid="admin-health-fts-in-sync"
        >
          In sync.
        </p>
      ) : (
        <p
          className="settings-status error"
          data-testid="admin-health-fts-out-of-sync"
        >
          Out of sync. Search can miss or misreport books until the index is
          rebuilt with <code translate="no">POST /api/fts/rebuild</code>.
        </p>
      )}
    </section>
  );
}

function StorageCard({ storage }: { storage: AdminHealthReport["storage"] }) {
  return (
    <section className="card ah-card" data-testid="admin-health-storage-card">
      <h3>Storage</h3>
      <div className="ah-kv">
        <KvRow
          label="Library content"
          value={formatBytes(storage.library_bytes)}
        />
        <KvRow label="Covers" value={formatBytes(storage.covers_bytes)} />
        <KvRow
          label="Thumbnail cache"
          value={formatCacheUsage(
            storage.thumbs_bytes,
            storage.thumbs_cap_bytes,
          )}
        />
        <KvRow
          label="HLS transcode cache"
          value={formatCacheUsage(storage.hls_bytes, storage.hls_cap_bytes)}
        />
        <KvRow
          label="Export-EPUB cache"
          value={formatCacheUsage(
            storage.export_epub_bytes,
            storage.export_epub_cap_bytes,
          )}
        />
      </div>
    </section>
  );
}

function ErrorLine({ entry }: { entry: CapturedError }) {
  return (
    <div className="logs-line" data-testid="admin-health-errors-row">
      <span className="logs-time">{formatUtcTimestamp(entry.timestamp)}</span>{" "}
      <span className="logs-level logs-level-error">ERROR</span>{" "}
      <span className="logs-module-cell">{entry.target}</span>{" "}
      <span className="logs-message">{entry.message}</span>
      {entry.book_uuid != null && (
        <>
          {" "}
          <Link
            to={`/books/${entry.book_uuid}`}
            className="logs-ref-link"
            data-testid="admin-health-errors-book-link"
          >
            Open book
          </Link>
        </>
      )}
      {entry.file != null && (
        <>
          {" "}
          <span
            className="logs-fields"
            translate="no"
            data-testid="admin-health-errors-file"
          >
            {entry.file}
          </span>
        </>
      )}
    </div>
  );
}

function LastErrorsCard({ entries }: { entries: CapturedError[] }) {
  return (
    <section className="card ah-card" data-testid="admin-health-errors-card">
      <h3>Last errors</h3>
      <p className="subtitle">
        Most recent server errors captured in memory, newest first.
      </p>
      {entries.length === 0 ? (
        <p className="settings-status" data-testid="admin-health-errors-empty">
          No errors captured since the server started.
        </p>
      ) : (
        <section
          className="logs-stream mono"
          data-testid="admin-health-errors-table"
          aria-label="Recent server errors"
        >
          {entries.map((entry, i) => (
            <ErrorLine
              // biome-ignore lint/suspicious/noArrayIndexKey: errors repeat within a second and have no id
              key={`${entry.timestamp}-${i}`}
              entry={entry}
            />
          ))}
        </section>
      )}
    </section>
  );
}

/** The server's health: index, worker queue, search index, storage and recent errors, polled while shown. */
export function HealthSection() {
  const health = useQuery(adminHealthQuery);
  const report = health.data;
  return (
    <div className="ah-page" data-testid="admin-health-page">
      {report === undefined ? (
        health.isError ? (
          <p
            className="settings-status error"
            role="status"
            data-testid="admin-health-error"
          >
            Couldn’t load server health. It’s retried every few seconds.
          </p>
        ) : (
          <Loading
            kind="section"
            className="start"
            testId="admin-health-loading"
            label="Taking the server's pulse"
          />
        )
      ) : (
        <>
          <div className="ah-grid" data-testid="admin-health-grid">
            <IndexStatusCard status={report.index} />
            <WorkerQueueCard entries={report.worker_queue} />
            <FtsHealthCard fts={report.fts} />
            <StorageCard storage={report.storage} />
          </div>
          <LastErrorsCard entries={report.last_errors} />
        </>
      )}
    </div>
  );
}
