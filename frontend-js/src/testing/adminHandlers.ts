import { HttpResponse, http } from "msw";
import type { MetadataLibrary } from "../api";
import {
  type AdminHealthReport,
  AdminSetUserPasswordBody,
  type AdminUserRow,
  type BackgroundTaskRecord,
  type CleanupKindCounts,
  CreateUserRequest,
  type DeviceView,
  type EbookConvertStatus,
  EbookConvertUpdate,
  type HardcoverKeyStatus,
  type LibraryContents,
  type LibrarySection,
  McpStatus,
  MetadataSource,
  RegistrationStatus,
  type SessionView,
  SetHardcoverKey,
  Settings,
  type SmtpConfigStatus,
  SmtpConfigUpdate,
  type TaskProgress,
  UserPermissions,
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

/** The order a library holds until it is saved, lowest priority first. */
export const DEFAULT_METADATA_ORDER: MetadataSource[] = [
  "folder_structure",
  "embedded_tags",
  "opf_sidecar",
  "omnibus_overrides",
  "provider_match",
];

export type SavedOrder = { library: MetadataLibrary; order: MetadataSource[] };

/**
 * `GET` and `POST /api/settings/metadata-precedence/{library}`: each library's
 * saved order, which a POST replaces. Each posted body lands in `saved`.
 */
export function metadataOrderHandlers({
  saved = [],
}: {
  saved?: SavedOrder[];
} = {}) {
  const orders = {
    ebook: DEFAULT_METADATA_ORDER,
    audiobook: DEFAULT_METADATA_ORDER,
  };
  return (["ebook", "audiobook"] as const).flatMap((library) => {
    const path = `/api/settings/metadata-precedence/${library}`;
    return [
      http.get(path, () => HttpResponse.json(orders[library])),
      http.post(path, async ({ request }) => {
        const order = MetadataSource.array().parse(await request.json());
        orders[library] = order;
        saved.push({ library, order });
        return HttpResponse.json(order);
      }),
    ];
  });
}

/** The counts `GET /api/admin/cleanup/counts` sends: every kind, in the server's order. */
export function aWireCleanupCounts(): CleanupKindCounts[] {
  return [
    { kind: "author", counts: { pending: 3, accepted: 1, rejected: 0 } },
    { kind: "series", counts: { pending: 0, accepted: 0, rejected: 0 } },
    { kind: "tag", counts: { pending: 4, accepted: 2, rejected: 1 } },
    { kind: "book_title", counts: { pending: 7, accepted: 0, rejected: 2 } },
  ];
}

/** `GET /api/admin/cleanup/counts`; `counts` is read on every request, so a story can change it between reads. */
export function cleanupCountsHandler(counts: () => CleanupKindCounts[]) {
  return http.get("/api/admin/cleanup/counts", () =>
    HttpResponse.json(counts()),
  );
}

/** `POST /api/admin/cleanup/detect`, answering as queued; `onDetect` runs on every POST. */
export function cleanupDetectHandler(onDetect: () => void = () => {}) {
  return http.post("/api/admin/cleanup/detect", () => {
    onDetect();
    return new HttpResponse(null, { status: 202 });
  });
}

/** An account as `GET /api/admin/users` lists it: a reader with two permissions. */
export function aWireAdminUser(
  overrides: Partial<AdminUserRow> = {},
): AdminUserRow {
  return {
    id: 7,
    username: "alice",
    is_admin: false,
    can_upload: true,
    can_edit: false,
    can_download: true,
    kindle_email: null,
    display_name: null,
    created_at: 1_700_000_000,
    locked: false,
    ...overrides,
  };
}

/** The accounts the People section lists: the signed-in admin, a locked reader and one with no permission. */
export function aWireAdminUsers(): AdminUserRow[] {
  return [
    aWireAdminUser({
      id: 1,
      username: "ada",
      is_admin: true,
      can_edit: true,
    }),
    aWireAdminUser({ locked: true, kindle_email: "alice@kindle.example" }),
    aWireAdminUser({
      id: 9,
      username: "bob",
      can_upload: false,
      can_download: false,
      created_at: 1_704_067_200,
    }),
  ];
}

/**
 * `GET /api/auth/registration` and `POST /api/settings/registration`: whether
 * sign-up is open, which a POST replaces. Each posted value lands in `saved`.
 */
export function registrationHandlers(
  initial: boolean,
  { saved = [] }: { saved?: boolean[] } = {},
) {
  let enabled = initial;
  return [
    http.get("/api/auth/registration", () => HttpResponse.json({ enabled })),
    http.post("/api/settings/registration", async ({ request }) => {
      enabled = RegistrationStatus.parse(await request.json()).enabled;
      saved.push(enabled);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/** What `usersHandlers` records of the writes it answers, for a story to assert on. */
export type UserWrites = {
  unlocked: number[];
  created: CreateUserRequest[];
  permissions: { id: number; permissions: UserPermissions }[];
  passwords: { id: number; password: string }[];
  deleted: number[];
};

/**
 * The `/api/admin/users` routes over one list of accounts: a create adds a row,
 * a permission change or an unlock edits one, a delete removes one. Every write
 * lands in its `UserWrites` list.
 */
export function usersHandlers(
  initial: AdminUserRow[],
  {
    unlocked = [],
    created = [],
    permissions = [],
    passwords = [],
    deleted = [],
  }: Partial<UserWrites> = {},
) {
  let rows = initial;
  const edit = (id: number, change: Partial<AdminUserRow>) => {
    rows = rows.map((row) => (row.id === id ? { ...row, ...change } : row));
  };
  const noContent = () => new HttpResponse(null, { status: 204 });
  return [
    http.get("/api/admin/users", () => HttpResponse.json(rows)),
    http.post("/api/admin/users", async ({ request }) => {
      const body = CreateUserRequest.parse(await request.json());
      created.push(body);
      const row = aWireAdminUser({
        id: Math.max(0, ...rows.map((r) => r.id)) + 1,
        username: body.username,
        ...body.permissions,
      });
      rows = [...rows, row];
      return HttpResponse.json(row, { status: 201 });
    }),
    http.patch(
      "/api/admin/users/:id/permissions",
      async ({ params, request }) => {
        const id = Number(params.id);
        const body = UserPermissions.parse(await request.json());
        permissions.push({ id, permissions: body });
        edit(id, body);
        return noContent();
      },
    ),
    http.post("/api/admin/users/:id/password", async ({ params, request }) => {
      const { password } = AdminSetUserPasswordBody.parse(await request.json());
      passwords.push({ id: Number(params.id), password });
      return noContent();
    }),
    http.post("/api/admin/users/:id/unlock", ({ params }) => {
      const id = Number(params.id);
      unlocked.push(id);
      edit(id, { locked: false });
      return noContent();
    }),
    http.delete("/api/admin/users/:id", ({ params }) => {
      const id = Number(params.id);
      deleted.push(id);
      rows = rows.filter((row) => row.id !== id);
      return noContent();
    }),
  ];
}

/** A live session as `GET /api/admin/users/{id}/sessions` lists it. */
export function aWireSession(
  overrides: Partial<SessionView> = {},
): SessionView {
  return {
    id: 3,
    kind: "cookie",
    client: "Firefox on macOS",
    device_id: null,
    created_at: 1_700_000_000,
    last_used_at: 1_704_067_200,
    expires_at: 1_706_659_200,
    is_current: false,
    ...overrides,
  };
}

/** A registered device as `GET /api/admin/users/{id}/devices` lists it. */
export function aWireDevice(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 4,
    name: "Kobo Clara",
    client_kind: "kobo",
    client_version: null,
    created_at: 1_700_000_000,
    last_seen_at: 1_704_067_200,
    ...overrides,
  };
}

/** What `sessionsHandlers` records of the revokes it answers. */
export type Revoked = { sessions: number[]; devices: number[] };

/**
 * The session and device lists of whichever user is asked about, and the two
 * revokes. Revoking a device also ends the sessions tied to it, as the server does.
 */
export function sessionsHandlers(
  initial: { sessions: SessionView[]; devices: DeviceView[] },
  { revoked = { sessions: [], devices: [] } }: { revoked?: Revoked } = {},
) {
  let { sessions, devices } = initial;
  const noContent = () => new HttpResponse(null, { status: 204 });
  return [
    http.get("/api/admin/users/:id/sessions", () =>
      HttpResponse.json(sessions),
    ),
    http.get("/api/admin/users/:id/devices", () => HttpResponse.json(devices)),
    http.delete("/api/admin/sessions/:id", ({ params }) => {
      const id = Number(params.id);
      revoked.sessions.push(id);
      sessions = sessions.filter((session) => session.id !== id);
      return noContent();
    }),
    http.delete("/api/admin/devices/:id", ({ params }) => {
      const id = Number(params.id);
      revoked.devices.push(id);
      devices = devices.filter((device) => device.id !== id);
      sessions = sessions.filter((session) => session.device_id !== id);
      return noContent();
    }),
  ];
}

/** A relay saved through the API, the way `GET /api/smtp` reports it. */
export function aWireSmtpStatus(
  overrides: Partial<SmtpConfigStatus> = {},
): SmtpConfigStatus {
  return {
    configured: true,
    host: "smtp.example.com",
    port: 465,
    username: "mailer",
    from_email: "library@example.com",
    password_masked: "••••",
    security: "tls",
    source: "settings",
    ...overrides,
  };
}

/** What `GET /api/smtp` reports before any relay is set up. */
export function anUnconfiguredSmtp(): SmtpConfigStatus {
  return {
    configured: false,
    host: null,
    port: null,
    username: null,
    from_email: null,
    password_masked: null,
    security: "starttls",
    source: "none",
  };
}

/** What `smtpHandlers` records of the writes it answers: each posted update, and each clear or test in order. */
export type SmtpWrites = {
  saved: SmtpConfigUpdate[];
  actions: ("clear" | "test")[];
};

/**
 * The `/api/smtp` routes over one relay: a save replaces it, a clear empties it,
 * a test sends nothing. Every write lands in `SmtpWrites`.
 */
export function smtpHandlers(
  initial: SmtpConfigStatus,
  { saved = [], actions = [] }: Partial<SmtpWrites> = {},
) {
  let current = initial;
  return [
    http.get("/api/smtp", () => HttpResponse.json(current)),
    http.post("/api/smtp", async ({ request }) => {
      const update = SmtpConfigUpdate.parse(await request.json());
      saved.push(update);
      current = aWireSmtpStatus({
        host: update.host,
        port: update.port,
        username: update.username,
        from_email: update.from_email,
        security: update.security ?? "starttls",
        password_masked: update.password ? "••••" : current.password_masked,
      });
      return HttpResponse.json(current);
    }),
    http.post("/api/smtp/clear", () => {
      actions.push("clear");
      current = anUnconfiguredSmtp();
      return HttpResponse.json(current);
    }),
    http.post("/api/smtp/test", () => {
      actions.push("test");
      return new HttpResponse(null, { status: 200 });
    }),
  ];
}

/** A server-wide key saved through the API, masked as `GET /api/hardcover-key` reports it. */
export function aWireKeyStatus(
  overrides: Partial<HardcoverKeyStatus> = {},
): HardcoverKeyStatus {
  return {
    configured: true,
    masked: "hc_l…3f9a",
    source: "settings",
    ...overrides,
  };
}

/** What a key route reports while no key is set. */
export const NO_KEY: HardcoverKeyStatus = {
  configured: false,
  masked: null,
  source: "none",
};

/**
 * `GET` and `POST` on one key route (`/api/hardcover-key` or
 * `/api/google-books-key`): a save sets the key, a null key removes it. Each
 * posted key, or null, lands in `saved`.
 */
export function secretKeyHandlers(
  path: "/api/hardcover-key" | "/api/google-books-key",
  initial: HardcoverKeyStatus,
  { saved = [] }: { saved?: (string | null)[] } = {},
) {
  let current = initial;
  return [
    http.get(path, () => HttpResponse.json(current)),
    http.post(path, async ({ request }) => {
      const key = SetHardcoverKey.parse(await request.json()).key ?? null;
      saved.push(key);
      current = key
        ? aWireKeyStatus({ masked: `${key.slice(0, 4)}…${key.slice(-4)}` })
        : NO_KEY;
      return HttpResponse.json(current);
    }),
  ];
}

/** `ebook-convert` found on the server's `PATH`, runnable. */
export function aWireEbookConvert(
  overrides: Partial<EbookConvertStatus> = {},
): EbookConvertStatus {
  return {
    available: true,
    path: "ebook-convert",
    source: "path",
    ...overrides,
  };
}

/**
 * `GET` and `POST /api/settings/ebook-convert`: a save pins the path, a null path
 * goes back to the `PATH` lookup. Each posted path, or null, lands in `saved`.
 */
export function ebookConvertHandlers(
  initial: EbookConvertStatus,
  { saved = [] }: { saved?: (string | null)[] } = {},
) {
  let current = initial;
  return [
    http.get("/api/settings/ebook-convert", () => HttpResponse.json(current)),
    http.post("/api/settings/ebook-convert", async ({ request }) => {
      const path = EbookConvertUpdate.parse(await request.json()).path ?? null;
      saved.push(path);
      current = path
        ? aWireEbookConvert({ path, source: "settings" })
        : aWireEbookConvert();
      return HttpResponse.json(current);
    }),
  ];
}

/**
 * `GET` and `POST /api/settings/mcp`: whether the endpoint is on, which a POST
 * replaces. Each posted value lands in `saved`.
 */
export function mcpHandlers(
  initial: boolean,
  { saved = [] }: { saved?: boolean[] } = {},
) {
  let enabled = initial;
  return [
    http.get("/api/settings/mcp", () => HttpResponse.json({ enabled })),
    http.post("/api/settings/mcp", async ({ request }) => {
      enabled = McpStatus.parse(await request.json()).enabled;
      saved.push(enabled);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/** A healthy server: both folders set, the search index in step, an idle worker and a quiet error ring. */
export function aWireAdminHealth(
  overrides: Partial<AdminHealthReport> = {},
): AdminHealthReport {
  return {
    index: {
      ebook_library_path: "/library/ebooks",
      audiobook_library_path: "/library/audiobooks",
      book_count: 42,
      author_count: 7,
      series_count: 3,
      ghosted_book_count: 0,
    },
    worker_queue: [],
    fts: { books_rows: 42, fts_rows: 42, in_sync: true },
    storage: {
      library_bytes: 3_100_000,
      covers_bytes: 512,
      thumbs_bytes: 1_000,
      thumbs_cap_bytes: 5_000_000_000,
      hls_bytes: 0,
      hls_cap_bytes: 5_000_000_000,
      export_epub_bytes: 2_000,
      export_epub_cap_bytes: 5_000_000_000,
    },
    last_errors: [],
    ...overrides,
  };
}

/** `GET /api/admin/health`; `report` is read on every poll, so a story can change it between polls. */
export function adminHealthHandler(report: () => AdminHealthReport) {
  return http.get("/api/admin/health", () => HttpResponse.json(report()));
}

/** The happy-path fakes for every admin section ported so far; a story's own handlers replace them. */
export function adminHandlers() {
  return [
    ...settingsHandlers(aWireSettings()),
    libraryContentsHandler(aWireLibraryContents),
    workerStatusHandler(aWireWorkerStatus),
    ...maintenanceJobHandlers(),
    backgroundTasksHandler(() => [aWireBackgroundTask()]),
    ...metadataOrderHandlers(),
    cleanupCountsHandler(aWireCleanupCounts),
    cleanupDetectHandler(),
    ...registrationHandlers(true),
    ...usersHandlers(aWireAdminUsers()),
    ...sessionsHandlers({
      sessions: [aWireSession()],
      devices: [aWireDevice()],
    }),
    ...smtpHandlers(aWireSmtpStatus()),
    ...secretKeyHandlers("/api/hardcover-key", aWireKeyStatus()),
    ...secretKeyHandlers("/api/google-books-key", NO_KEY),
    ...ebookConvertHandlers(aWireEbookConvert()),
    ...mcpHandlers(false),
    adminHealthHandler(aWireAdminHealth),
  ];
}
