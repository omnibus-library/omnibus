import { type ExpectMutationOptions, post } from "../utils/api";

/** The account endpoints the personal Settings sections post to. */
export const accountUrls = {
  scrollStops: /\/api\/rpc\/account\/book-detail-scroll-stops(?:\?|$)/,
  shareStats: /\/api\/rpc\/account\/share-stats(?:\?|$)/,
  stackSeries: /\/api\/rpc\/account\/stack-series(?:\?|$)/,
  kindleEmail: /\/api\/rpc\/account\/kindle-email(?:\?|$)/,
  kindleDelivery: /\/api\/rpc\/kindle\/delivery(?:\?|$)/,
  changePassword: /\/api\/rpc\/account\/change-password(?:\?|$)/,
  profile: /\/api\/rpc\/account\/profile(?:\?|$)/,
  avatar: /\/api\/account\/avatar(?:\?|$)/,
  hiddenFormats: /\/api\/rpc\/account\/hidden-formats(?:\?|$)/,
  kosyncGenerate: /\/api\/rpc\/kosync\/generate(?:\?|$)/,
  sessions: /\/api\/auth\/sessions(?:\?|$)/,
  sessionRevoke: /\/api\/auth\/sessions\/\d+(?:\?|$)/,
  annualGoal: /\/api\/rpc\/stats-goal(?:\?|$)/,
  dailyGoal: /\/api\/rpc\/stats-goal-daily(?:\?|$)/,
};

function switchWrite(url: RegExp, enabled?: boolean): ExpectMutationOptions {
  return post(url, enabled === undefined ? undefined : { enabled });
}

// The config pins the browser to UTC, so every stats write declares offset 0 (rule 10).
const UTC = { utc_offset_minutes: 0 };

/** An omitted argument leaves the body unchecked. */
export const account = {
  scrollStops: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.scrollStops, enabled),

  shareStats: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.shareStats, enabled),

  stackSeries: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.stackSeries, enabled),

  /** A null address is the clear. */
  kindleEmail: (email?: string | null): ExpectMutationOptions =>
    post(accountUrls.kindleEmail, email === undefined ? undefined : { email }),

  changePassword: (
    current: string,
    replacement: string,
    status = 200,
  ): ExpectMutationOptions =>
    post(
      accountUrls.changePassword,
      { current_password: current, new_password: replacement },
      status,
    ),

  /** A null name is the clear. */
  profile: (displayName?: string | null): ExpectMutationOptions =>
    post(
      accountUrls.profile,
      displayName === undefined ? undefined : { display_name: displayName },
    ),

  avatar: (status = 204): ExpectMutationOptions =>
    post(accountUrls.avatar, undefined, status),

  hiddenFormats: (formats?: string[]): ExpectMutationOptions =>
    post(
      accountUrls.hiddenFormats,
      formats === undefined ? undefined : { formats },
    ),

  kosyncPassword: (): ExpectMutationOptions => post(accountUrls.kosyncGenerate),

  annualGoal: (target: number): ExpectMutationOptions =>
    post(accountUrls.annualGoal, { update: { target }, ...UTC }),

  /** Without a target the write clears the goal: `target` is omitted on the wire. */
  dailyGoal: (
    kind: "pages" | "minutes",
    target?: number,
  ): ExpectMutationOptions =>
    post(accountUrls.dailyGoal, {
      update: target === undefined ? { kind } : { kind, target },
      ...UTC,
    }),
};
