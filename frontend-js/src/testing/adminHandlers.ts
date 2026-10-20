import { HttpResponse, http } from "msw";
import {
  type BackgroundTaskRecord,
  type LibraryContents,
  type LibrarySection,
  Settings,
  type TaskProgress,
  type WorkerStatus,
} from "../api/generated/schemas";

// MSW fakes and fixtures for the server-administration screens, typed by the
// generated schemas so a fixture that drifts from the spec fails to compile.

/** A library folder as `GET /api/library` reports it. */
export function aWireLibrarySection(
  overrides: Partial<LibrarySection> = {},
): LibrarySection {
  return {
    path: "/library/ebooks",
    total_files: 5,
    counts_by_ext: [
      ["epub", 4],
      ["pdf", 1],
    ],
    error: null,
    ...overrides,
  };
}

/** What `GET /api/library` reports for both folders. */
export function aWireLibraryContents(
  overrides: Partial<LibraryContents> = {},
): LibraryContents {
  return {
    ebooks: aWireLibrarySection(),
    audiobooks: aWireLibrarySection({
      path: "/library/audiobooks",
      total_files: 2,
      counts_by_ext: [["m4b", 2]],
    }),
    ...overrides,
  };
}

/** The library settings `GET /api/settings` sends. */
export function aWireSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ebook_library_path: "/library/ebooks",
    audiobook_library_path: "/library/audiobooks",
    scan_interval_hours: 24,
    ...overrides,
  };
}

/**
 * `GET` and `POST /api/settings`: the settings last saved, which a POST
 * replaces. Each posted body lands in `saved`.
 */
export function settingsHandlers(
  initial: Settings,
  { saved = [] }: { saved?: Settings[] } = {},
) {
  let current = initial;
  return [
    http.get("/api/settings", () => HttpResponse.json(current)),
    http.post("/api/settings", async ({ request }) => {
      current = Settings.parse(await request.json());
      saved.push(current);
      return HttpResponse.json(current);
    }),
  ];
}

/** `GET /api/library`; `contents` is read on every request, so a story can change it between reads. */
export function libraryContentsHandler(contents: () => LibraryContents) {
  return http.get("/api/library", () => HttpResponse.json(contents()));
}

/** A task in the worker feed: a scan that has not counted its files yet. */
export function aWireTaskProgress(
  overrides: Partial<TaskProgress> = {},
): TaskProgress {
  return {
    task_id: 1,
    kind: "scan",
    state: { state: "running", processed: 0 },
    started_at_ms: 1_700_000_000_000,
    last_update_ms: 1_700_000_001_000,
    ...overrides,
  };
}

/** The worker feed `GET /api/worker/status` sends; idle unless overridden. */
export function aWireWorkerStatus(
  overrides: Partial<WorkerStatus> = {},
): WorkerStatus {
  return { active: [], recent_complete: [], ...overrides };
}

/** `GET /api/worker/status`; `status` is read on every poll, so a story can change the feed between polls. */
export function workerStatusHandler(status: () => WorkerStatus) {
  return http.get("/api/worker/status", () => HttpResponse.json(status()));
}

/** One recorded run of a background task, finished 45 s after it started. */
export function aWireBackgroundTask(
  overrides: Partial<BackgroundTaskRecord> = {},
): BackgroundTaskRecord {
  return {
    id: 1,
    task_kind: "scan",
    status: "success",
    started_at: 1_700_000_000,
    finished_at: 1_700_000_045,
    error: null,
    ...overrides,
  };
}

/** `GET /api/admin/background-tasks`; `tasks` is read on every request. */
export function backgroundTasksHandler(tasks: () => BackgroundTaskRecord[]) {
  return http.get("/api/admin/background-tasks", () =>
    HttpResponse.json(tasks()),
  );
}

export const JOB_ROUTES = {
  scan: "/api/scan-library",
  photos: "/api/authors/refetch-photos",
  chapters: "/api/audiobooks/backfill-chapters",
  bake: "/api/admin/rewrite-all-epubs",
} as const;

/** The four maintenance job routes, each answering as queued; every POST lands in `queued` as its path. */
export function maintenanceJobHandlers(queued: string[] = []) {
  return Object.values(JOB_ROUTES).map((path) =>
    http.post(path, () => {
      queued.push(path);
      return new HttpResponse(null, { status: 200 });
    }),
  );
}

/** The happy-path fakes for every admin section ported so far; a story's own handlers replace them. */
export function adminHandlers() {
  return [
    ...settingsHandlers(aWireSettings()),
    libraryContentsHandler(aWireLibraryContents),
    workerStatusHandler(aWireWorkerStatus),
    ...maintenanceJobHandlers(),
    backgroundTasksHandler(() => [aWireBackgroundTask()]),
  ];
}
