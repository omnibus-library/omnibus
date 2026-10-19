import { HttpResponse, http } from "msw";
import type { GoalTargets } from "../api";
import {
  DailyGoalUpdate,
  ReadingGoalUpdate,
  SetHiddenFormats,
  SetKindleEmail,
  SetProfile,
  SetStackSeries,
  type UserSummary,
} from "../api/generated/schemas";
import { svg } from "./handlers";
import { aWireStatsGoals, WIRE_ADA } from "./wire";

/** What the fake settings routes read and write, so a write shows on the next read. */
export type SettingsServer = {
  user: UserSummary;
  goals: GoalTargets;
  /** Each goal write that landed, as `kind=target`. */
  goalWrites: string[];
  /** Goal kinds whose write the server refuses. */
  refuseGoals: string[];
  /** The address `GET /api/kindle/delivery` sends from; `null` is no email delivery. */
  sender: string | null;
};

export const aSettingsServer = (
  init: Partial<SettingsServer> = {},
): SettingsServer => ({
  user: WIRE_ADA,
  goals: [null, null, null],
  goalWrites: [],
  refuseGoals: [],
  sender: "library@example.com",
  ...init,
});

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
    http.get("/api/users/:id/avatar", svg),
    ...SWITCH_ROUTES.map(([route, field]) =>
      http.post(`/api/account/${route}`, async ({ request }) => {
        patch({ [field]: SetStackSeries.parse(await request.json()).enabled });
        return empty();
      }),
    ),
    http.get("/api/stats", () =>
      HttpResponse.json(aWireStatsGoals(...server.goals)),
    ),
    http.put("/api/stats/goal", async ({ request }) => {
      const { target } = ReadingGoalUpdate.parse(await request.json());
      if (server.refuseGoals.includes("books")) return refused();
      server.goalWrites.push(`books=${target}`);
      server.goals = [target ?? null, server.goals[1], server.goals[2]];
      return HttpResponse.json(null);
    }),
    http.put("/api/stats/goal/daily", async ({ request }) => {
      const { kind, target } = DailyGoalUpdate.parse(await request.json());
      if (server.refuseGoals.includes(kind)) return refused();
      server.goalWrites.push(`${kind}=${target}`);
      const goals: GoalTargets = [...server.goals];
      goals[kind === "pages" ? 1 : 2] = target ?? null;
      server.goals = goals;
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
    http.post("/api/account/hidden-formats", async ({ request }) => {
      const { formats } = SetHiddenFormats.parse(await request.json());
      patch({ hidden_formats: formats ?? [] });
      return empty();
    }),
  ];
}
