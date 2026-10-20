import { useQuery } from "@tanstack/react-query";
import { type BackgroundTaskRecord, backgroundTasksQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { RowSkeletons } from "../../components/Loading/Loading";
import { formatUtcTimestamp } from "../../format";
import { fmtDuration, recordKindLabel } from "./recentTasks";

const STATUSES = {
  running: { label: "RUNNING", className: "logs-level logs-level-info" },
  success: { label: "SUCCESS", className: "logs-level logs-level-info" },
  failed: { label: "FAILED", className: "logs-level logs-level-error" },
} satisfies Record<
  BackgroundTaskRecord["status"],
  { label: string; className: string }
>;

function TaskLine({ task }: { task: BackgroundTaskRecord }) {
  const status = STATUSES[task.status];
  return (
    <div className="logs-line" data-testid="background-tasks-row">
      <span className="logs-time">{formatUtcTimestamp(task.started_at)}</span>{" "}
      <span className={status.className}>{status.label}</span>{" "}
      <span className="logs-module-cell">
        {recordKindLabel(task.task_kind)}
      </span>{" "}
      <span className="logs-fields" data-testid="background-tasks-duration">
        {fmtDuration({
          startedAt: task.started_at,
          finishedAt: task.finished_at,
        })}
      </span>
      {task.error != null && (
        <>
          {" "}
          <span
            className="logs-message"
            data-testid="background-tasks-row-error"
          >
            {task.error}
          </span>
        </>
      )}
    </div>
  );
}

/** The worker's recorded task runs with their status and timing. */
export function RecentTasksCard() {
  const tasks = useQuery(backgroundTasksQuery);
  return (
    <section className="card" data-testid="background-tasks-card">
      <h3>Recent tasks</h3>
      <p className="subtitle">
        Worker task runs, newest first. The history survives a server restart.
      </p>
      {tasks.data === undefined ? (
        tasks.isError ? (
          <div className="settings-actions">
            <p
              className="settings-status error"
              role="status"
              data-testid="background-tasks-error"
            >
              Couldn’t load the task history.
            </p>
            <Button
              variant="ghost"
              data-testid="background-tasks-retry"
              onClick={() => tasks.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            data-testid="background-tasks-loading"
          >
            <span className="ld-sr">Reading the task history</span>
            <RowSkeletons count={4} avatar={false} />
          </div>
        )
      ) : tasks.data.length === 0 ? (
        <p
          className="settings-status"
          role="status"
          data-testid="background-tasks-empty"
        >
          No background tasks have run since this history began.
        </p>
      ) : (
        <section
          className="logs-stream mono"
          data-testid="background-tasks-table"
          aria-label="Recent background tasks"
        >
          {tasks.data.map((task) => (
            <TaskLine key={task.id} task={task} />
          ))}
        </section>
      )}
    </section>
  );
}
