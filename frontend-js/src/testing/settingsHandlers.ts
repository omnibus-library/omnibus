import { HttpResponse, http } from "msw";
import { SetProfile, type UserSummary } from "../api/generated/schemas";
import { svg } from "./handlers";
import { WIRE_ADA } from "./wire";

/** What the fake settings routes read and write, so a write shows on the next read. */
export type SettingsServer = { user: UserSummary };

export const aSettingsServer = (
  user: UserSummary = WIRE_ADA,
): SettingsServer => ({ user: { ...user } });

const empty = (status = 200) => new HttpResponse(null, { status });

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
  ];
}
