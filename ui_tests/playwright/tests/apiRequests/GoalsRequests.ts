import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

type DailyGoal = { kind: "pages" | "minutes"; target: number | null };

/** The reading goals of the context's user; a null target clears one. */
export class GoalsRequests extends BaseRequests {
  putAnnualGoal(body: { target: number | null }): Promise<APIResponse> {
    return this.put("/api/stats/goal", body);
  }

  putDailyGoals(body: DailyGoal): Promise<APIResponse> {
    return this.put("/api/stats/goal/daily", body);
  }

  /** Clears the annual goal, then the daily pages and minutes goals. */
  async clearAll(): Promise<APIResponse[]> {
    return [
      await this.putAnnualGoal({ target: null }),
      await this.putDailyGoals({ kind: "pages", target: null }),
      await this.putDailyGoals({ kind: "minutes", target: null }),
    ];
  }
}
