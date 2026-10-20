import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type TaskProgress, workerStatusQuery } from "../../api";
import { Ring } from "../Loading/Loading";
import {
  activeTalliesLine,
  bakeErrorsMessage,
  ghostWarningMessage,
  talliesChanges,
  workerKindLabel,
} from "./workerLines";
import "./WorkerStatus.css";

const IDLE: { active: TaskProgress[]; recent_complete: TaskProgress[] } = {
  active: [],
  recent_complete: [],
};

const TONES = {
  done: { className: "worker-status-row worker-status-done", icon: "✓" },
  warn: { className: "worker-status-row worker-status-warn", icon: "!" },
  failed: { className: "worker-status-row worker-status-failed", icon: "!" },
};

type Terminal = {
  tone: keyof typeof TONES;
  label: string;
  message: string | null;
  testId?: string;
  messageTestId?: string;
};

/** What a finished task's row says; a task still running has none. */
function terminal(task: TaskProgress): Terminal | null {
  const { state } = task;
  const label = workerKindLabel(task.kind, false);
  switch (state.state) {
    case "running":
      return null;
    case "failed":
      return {
        tone: "failed",
        label: `${label} failed`,
        message: state.message,
      };
    case "done": {
      if (state.ghost_warning) {
        return {
          tone: "warn",
          label: `${label} finished with a warning`,
          message: ghostWarningMessage(state.ghost_warning),
          testId: "worker-status-warn-row",
        };
      }
      if (state.bake_errors?.length) {
        return {
          tone: "warn",
          label: "EPUB override bake finished with errors",
          message: bakeErrorsMessage(state.bake_errors),
          testId: "worker-status-bake-errors-row",
        };
      }
      const tallies = task.detail?.tallies;
      return {
        tone: "done",
        label,
        message: tallies ? talliesChanges(tallies) : null,
        messageTestId: "worker-status-summary",
      };
    }
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function ActiveRow({ task }: { task: TaskProgress }) {
  const { state, detail } = task;
  const count =
    state.state === "running" && state.total != null
      ? ` (${state.processed} / ${state.total})`
      : "";
  return (
    <div className="worker-status-row worker-status-active">
      <Ring size="xs" />
      <div className="worker-status-body">
        <div className="worker-status-label">
          {workerKindLabel(task.kind, true)}
          {count}
        </div>
        {detail?.phase && (
          <div
            className="worker-status-phase"
            data-testid="worker-status-phase"
          >
            {detail.phase}
          </div>
        )}
        {detail?.current_item && (
          <div className="worker-status-item" data-testid="worker-status-item">
            {detail.current_item}
          </div>
        )}
        {detail?.tallies && (
          <div
            className="worker-status-tallies"
            data-testid="worker-status-tallies"
          >
            {activeTalliesLine(detail.tallies)}
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalRow({
  row,
  onDismiss,
}: {
  row: Terminal;
  onDismiss: () => void;
}) {
  const { className, icon } = TONES[row.tone];
  return (
    <div
      className={className}
      data-testid={row.testId}
      role={row.tone === "failed" ? "alert" : undefined}
    >
      <span className="worker-status-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="worker-status-body">
        <div className="worker-status-label">{row.label}</div>
        {row.message !== null && (
          <div
            className="worker-status-message"
            data-testid={row.messageTestId}
          >
            {row.message}
          </div>
        )}
      </div>
      <button
        type="button"
        className="worker-status-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}

/** The worker's task feed, polled once a second: running tasks, then the ones that just finished. Draws nothing when idle. */
export function WorkerStatus() {
  const { data } = useQuery(workerStatusQuery);
  const { active, recent_complete } = data ?? IDLE;
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());

  // Ids repeat after a server restart, so forget the ones the server has dropped.
  const live = recent_complete.filter((t) => dismissed.has(t.task_id));
  if (live.length !== dismissed.size) {
    setDismissed(new Set(live.map((t) => t.task_id)));
  }

  const finished = recent_complete.filter((t) => !dismissed.has(t.task_id));
  if (active.length === 0 && finished.length === 0) return null;

  const dismiss = (id: number) => setDismissed(new Set([...dismissed, id]));
  return (
    <div
      className="worker-status"
      role="status"
      aria-live="polite"
      data-testid="worker-status"
    >
      {active.map((task) => (
        <ActiveRow key={task.task_id} task={task} />
      ))}
      {finished.map((task) => {
        const row = terminal(task);
        return row ? (
          <TerminalRow
            key={task.task_id}
            row={row}
            onDismiss={() => dismiss(task.task_id)}
          />
        ) : (
          <ActiveRow key={task.task_id} task={task} />
        );
      })}
    </div>
  );
}
