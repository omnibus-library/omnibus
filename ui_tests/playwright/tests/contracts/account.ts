import type { ExpectMutationOptions } from "../utils/api";

/** The account endpoints Settings → Account and Kindle post to. */
export const accountUrls = {
  scrollStops: /\/api\/rpc\/account\/book-detail-scroll-stops(?:\?|$)/,
  shareStats: /\/api\/rpc\/account\/share-stats(?:\?|$)/,
  stackSeries: /\/api\/rpc\/account\/stack-series(?:\?|$)/,
  kindleEmail: /\/api\/rpc\/account\/kindle-email(?:\?|$)/,
  changePassword: /\/api\/rpc\/account\/change-password(?:\?|$)/,
  profile: /\/api\/rpc\/account\/profile(?:\?|$)/,
  avatar: /\/api\/account\/avatar(?:\?|$)/,
  hiddenFormats: /\/api\/rpc\/account\/hidden-formats(?:\?|$)/,
  annualGoal: /\/api\/rpc\/stats-goal(?:\?|$)/,
  dailyGoal: /\/api\/rpc\/stats-goal-daily(?:\?|$)/,
};

function write(
  url: RegExp,
  expectedBody?: unknown,
  expectedStatus = 200,
): ExpectMutationOptions {
  return { method: "POST", url, expectedBody, expectedStatus };
}

function switchWrite(url: RegExp, enabled?: boolean): ExpectMutationOptions {
  return write(url, enabled === undefined ? undefined : { enabled });
}

// The config pins the browser to UTC, so every stats write declares offset 0 (rule 10).
const UTC = { utc_offset_minutes: 0 };

/** Each omitted argument leaves the body unchecked, as the originals did. */
export const account = {
  scrollStops: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.scrollStops, enabled),

  shareStats: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.shareStats, enabled),

  stackSeries: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.stackSeries, enabled),

  kindleEmail: (email?: string): ExpectMutationOptions =>
    write(accountUrls.kindleEmail, email === undefined ? undefined : { email }),

  changePassword: (
    current: string,
    replacement: string,
    status = 200,
  ): ExpectMutationOptions =>
    write(
      accountUrls.changePassword,
      { current_password: current, new_password: replacement },
      status,
    ),

  profile: (displayName?: string): ExpectMutationOptions =>
    write(
      accountUrls.profile,
      displayName === undefined ? undefined : { display_name: displayName },
    ),

  avatar: (status = 204): ExpectMutationOptions =>
    write(accountUrls.avatar, undefined, status),

  hiddenFormats: (): ExpectMutationOptions => write(accountUrls.hiddenFormats),

  annualGoal: (target: number): ExpectMutationOptions =>
    write(accountUrls.annualGoal, { update: { target }, ...UTC }),

  /** Without a target the write clears the goal: `target` is omitted on the wire. */
  dailyGoal: (
    kind: "pages" | "minutes",
    target?: number,
  ): ExpectMutationOptions =>
    write(accountUrls.dailyGoal, {
      update: target === undefined ? { kind } : { kind, target },
      ...UTC,
    }),
};
