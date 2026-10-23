import { HttpResponse, http } from "msw";
import type { GoalTargets } from "../api";
import {
  type ApiTokenView,
  ChangePasswordRequest,
  CreateApiTokenRequest,
  CreateKoboDevice,
  DailyGoalUpdate,
  type KoboDeviceView,
  ReadingGoalUpdate,
  RenameApiTokenRequest,
  type SessionView,
  SetHiddenFormats,
  SetKindleEmail,
  SetProfile,
  SetStackSeries,
  type UserSummary,
} from "../api/generated/schemas";
import { svg } from "./handlers";
import {
  aWireApiToken,
  aWireKoboDevice,
  aWireStatsGoals,
  WIRE_ADA,
} from "./wire";

/** What the fake settings routes read and write, so a write shows on the next read. */
export type SettingsServer = {
  user: UserSummary;
  goals: GoalTargets;
  /** Each goal write that landed, as `kind=target`. */
  goalWrites: string[];
  /** The `utc_offset_minutes` each goal write carried. */
  goalOffsets: (string | null)[];
  /** Goal kinds whose write the server refuses. */
  refuseGoals: string[];
  /** The address `GET /api/kindle/delivery` sends from; `null` is no email delivery. */
  sender: string | null;
  /** The reader's Kobos. */
  kobo: KoboDeviceView[];
  /** The reader's API tokens, newest first. */
  tokens: ApiTokenView[];
  /** The reader's sessions; the one flagged `is_current` is the page's own. */
  sessions: SessionView[];
  /** The password `POST /api/auth/password` expects as the current one. */
  password: string;
};

export const aSettingsServer = (
  init: Partial<SettingsServer> = {},
): SettingsServer => ({
  user: WIRE_ADA,
  goals: { books: null, pages: null, minutes: null },
  goalWrites: [],
  goalOffsets: [],
  refuseGoals: [],
  sender: "library@example.com",
  kobo: [],
  password: "old-password-123",
  sessions: [],
  tokens: [],
  ...init,
});

const missing = () =>
  new HttpResponse("kobo device not found", { status: 404 });

const refused = () => new HttpResponse("target refused", { status: 400 });

const empty = (status = 200) => new HttpResponse(null, { status });

// The three switches share one body, `{enabled}`.
const SWITCH_ROUTES = [
  ["stack-series", "stack_series"],
  ["book-detail-scroll-stops", "book_detail_scroll_stops"],
  ["share-stats", "share_stats"],
] as const;

/** The settings routes over `server`; a story that needs a refusal passes its own handler first. */
export function settingsHandlers(server: SettingsServer) {
  const patch = (changes: Partial<UserSummary>) => {
    server.user = { ...server.user, ...changes };
  };
  return [
    http.get("/api/auth/me", () => HttpResponse.json(server.user)),
    http.post("/api/account/profile", async ({ request }) => {
      const { display_name } = SetProfile.parse(await request.json());
      patch({ display_name: display_name?.trim() || null });
      return empty();
    }),
    http.post("/api/account/avatar", async ({ request }) => {
      const avatar = (await request.formData()).get("avatar");
      if (!(avatar instanceof File))
        return new HttpResponse("no avatar part", { status: 400 });
      patch({ has_avatar: true });
      return empty(204);
    }),
    http.delete("/api/account/avatar", () => {
      patch({ has_avatar: false });
      return empty(204);
    }),
    http.get("/api/users/:id/avatar", () =>
      server.user.has_avatar ? svg() : new HttpResponse(null, { status: 404 }),
    ),
    ...SWITCH_ROUTES.map(([route, field]) =>
      http.post(`/api/account/${route}`, async ({ request }) => {
        patch({ [field]: SetStackSeries.parse(await request.json()).enabled });
        return empty();
      }),
    ),
    http.get("/api/stats", () =>
      HttpResponse.json(aWireStatsGoals(server.goals)),
    ),
    http.put("/api/stats/goal", async ({ request }) => {
      server.goalOffsets.push(
        new URL(request.url).searchParams.get("utc_offset_minutes"),
      );
      const { target } = ReadingGoalUpdate.parse(await request.json());
      if (server.refuseGoals.includes("books")) return refused();
      server.goalWrites.push(`books=${target}`);
      server.goals = { ...server.goals, books: target ?? null };
      return HttpResponse.json(null);
    }),
    http.put("/api/stats/goal/daily", async ({ request }) => {
      server.goalOffsets.push(
        new URL(request.url).searchParams.get("utc_offset_minutes"),
      );
      const { kind, target } = DailyGoalUpdate.parse(await request.json());
      if (server.refuseGoals.includes(kind)) return refused();
      server.goalWrites.push(`${kind}=${target}`);
      server.goals = { ...server.goals, [kind]: target ?? null };
      return HttpResponse.json({});
    }),
    http.get("/api/kindle/delivery", () =>
      HttpResponse.json({ sender_address: server.sender }),
    ),
    http.post("/api/account/kindle-email", async ({ request }) => {
      const { email } = SetKindleEmail.parse(await request.json());
      patch({ kindle_email: email?.trim() || null });
      return empty();
    }),
    http.get("/api/account/kobo-devices", () => HttpResponse.json(server.kobo)),
    http.post("/api/account/kobo-devices", async ({ request }) => {
      const { name, kind } = CreateKoboDevice.parse(await request.json());
      const id = Math.max(0, ...server.kobo.map((d) => d.id)) + 1;
      const device = aWireKoboDevice({
        id,
        name: name.trim(),
        kind,
        token: `tok-${id}`,
      });
      server.kobo = [...server.kobo, device];
      return HttpResponse.json(device);
    }),
    http.post("/api/account/kobo-devices/:id/regenerate", ({ params }) => {
      const found = server.kobo.find((d) => d.id === Number(params.id));
      if (!found) return missing();
      const device = { ...found, token: `${found.token}-new` };
      server.kobo = server.kobo.map((d) => (d.id === device.id ? device : d));
      return HttpResponse.json(device);
    }),
    http.delete("/api/account/kobo-devices/:id", ({ params }) => {
      if (!server.kobo.some((d) => d.id === Number(params.id)))
        return missing();
      server.kobo = server.kobo.filter((d) => d.id !== Number(params.id));
      return empty(204);
    }),
    http.get("/api/auth/api-tokens", () => HttpResponse.json(server.tokens)),
    http.post("/api/auth/api-tokens", async ({ request }) => {
      const { name } = CreateApiTokenRequest.parse(await request.json());
      const id = Math.max(0, ...server.tokens.map((t) => t.id)) + 1;
      const token = aWireApiToken({ id, name: name.trim(), suffix: "Zz9x" });
      server.tokens = [token, ...server.tokens];
      return HttpResponse.json({ token, secret: "omni_secretvalue-Zz9x" });
    }),
    http.patch("/api/auth/api-tokens/:id", async ({ params, request }) => {
      const { name } = RenameApiTokenRequest.parse(await request.json());
      if (!server.tokens.some((t) => t.id === Number(params.id)))
        return missing();
      server.tokens = server.tokens.map((t) =>
        t.id === Number(params.id) ? { ...t, name: name.trim() } : t,
      );
      return empty(204);
    }),
    http.delete("/api/auth/api-tokens/:id", ({ params }) => {
      if (!server.tokens.some((t) => t.id === Number(params.id)))
        return missing();
      server.tokens = server.tokens.filter((t) => t.id !== Number(params.id));
      return empty(204);
    }),
    http.get("/api/auth/sessions", () => HttpResponse.json(server.sessions)),
    http.delete("/api/auth/sessions/:id", ({ params }) => {
      const id = Number(params.id);
      if (!server.sessions.some((s) => s.id === id && !s.is_current))
        return missing();
      server.sessions = server.sessions.filter((s) => s.id !== id);
      return empty(204);
    }),
    http.post("/api/auth/password", async ({ request }) => {
      const body = ChangePasswordRequest.parse(await request.json());
      if (body.current_password !== server.password) {
        return new HttpResponse("current password is incorrect", {
          status: 403,
        });
      }
      if (body.new_password.length < 10) {
        return new HttpResponse("password too short (min 10)", {
          status: 400,
        });
      }
      server.password = body.new_password;
      // Every other session is signed out; this one stays.
      server.sessions = server.sessions.filter((s) => s.is_current);
      return empty(204);
    }),
    http.post("/api/account/hidden-formats", async ({ request }) => {
      const { formats } = SetHiddenFormats.parse(await request.json());
      patch({ hidden_formats: formats ?? [] });
      return empty();
    }),
  ];
}
