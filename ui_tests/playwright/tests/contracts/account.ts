import { type ExpectMutationOptions, post } from "../utils/api";

/** The account endpoints the personal Settings sections post to. */
export const accountUrls = {
  scrollStops: /\/api\/account\/book-detail-scroll-stops(?:\?|$)/,
  shareStats: /\/api\/account\/share-stats(?:\?|$)/,
  stackSeries: /\/api\/account\/stack-series(?:\?|$)/,
  kindleEmail: /\/api\/account\/kindle-email(?:\?|$)/,
  kindleDelivery: /\/api\/kindle\/delivery(?:\?|$)/,
  changePassword: /\/api\/auth\/password(?:\?|$)/,
  profile: /\/api\/account\/profile(?:\?|$)/,
  avatar: /\/api\/account\/avatar(?:\?|$)/,
  hiddenFormats: /\/api\/account\/hidden-formats(?:\?|$)/,
  kosyncGenerate: /\/api\/account\/kosync(?:\?|$)/,
  sessions: /\/api\/auth\/sessions(?:\?|$)/,
  sessionRevoke: /\/api\/auth\/sessions\/\d+(?:\?|$)/,
  // Days are cut on the asking client's clock, so the offset rides the query (rule 10).
  annualGoal: /\/api\/stats\/goal\?utc_offset_minutes=0$/,
  dailyGoal: /\/api\/stats\/goal\/daily\?utc_offset_minutes=0$/,
};

function switchWrite(url: RegExp, enabled?: boolean): ExpectMutationOptions {
  return post(url, enabled === undefined ? undefined : { enabled });
}

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
    status = 204,
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

  annualGoal: (target: number): ExpectMutationOptions => ({
    ...post(accountUrls.annualGoal, { target }),
    method: "PUT",
  }),

  /** Without a target the write clears the goal: `target` is null on the wire. */
  dailyGoal: (
    kind: "pages" | "minutes",
    target?: number,
  ): ExpectMutationOptions => ({
    ...post(accountUrls.dailyGoal, { kind, target: target ?? null }),
    method: "PUT",
  }),
};
