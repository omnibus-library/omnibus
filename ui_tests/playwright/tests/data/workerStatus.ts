/** How many files a scan has found, by what happened to each. */
export type ScanTallies = {
  found: number;
  new: number;
  changed: number;
  removed: number;
  moved: number;
  unchanged: number;
};

/** One background task as `POST /api/rpc/worker_status` lists it. */
export type WorkerTask = {
  task_id: number;
  kind: "scan" | "generate_thumbs" | "resolve_author_photo";
  state:
    | { state: "running"; processed: number; total?: number | null }
    | { state: "done"; processed: number }
    | { state: "failed"; message: string };
  resource_key?: string | null;
  detail?: {
    phase?: string;
    current_item?: string;
    tallies?: ScanTallies;
  };
  started_at_ms: number;
  last_update_ms: number;
};

/** The worker's running tasks and its recently finished ones. */
export type WorkerStatus = {
  active: WorkerTask[];
  recent_complete: WorkerTask[];
};

/** A library scan that started and last reported just now. */
export function buildScanTask(
  fields: Pick<WorkerTask, "task_id" | "state"> & Partial<WorkerTask>,
): WorkerTask {
  const now = Date.now();
  return { kind: "scan", started_at_ms: now, last_update_ms: now, ...fields };
}
