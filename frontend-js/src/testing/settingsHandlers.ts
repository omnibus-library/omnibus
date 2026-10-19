import { HttpResponse, http } from "msw";
import {
  SetHiddenFormats,
  SetProfile,
  SetStackSeries,
  type UserSummary,
} from "../api/generated/schemas";
import { svg } from "./handlers";
import { WIRE_ADA } from "./wire";

/** What the fake settings routes read and write, so a write shows on the next read. */
export type SettingsServer = { user: UserSummary };

export const aSettingsServer = (
  user: UserSummary = WIRE_ADA,
): SettingsServer => ({ user: { ...user } });

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
    http.post("/api/account/hidden-formats", async ({ request }) => {
      const { formats } = SetHiddenFormats.parse(await request.json());
      patch({ hidden_formats: formats ?? [] });
      return empty();
    }),
  ];
}
