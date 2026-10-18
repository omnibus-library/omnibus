const SIGNED_OUT_PATHS = ["/login", "/register", "/connect"];

/**
 * The in-app path a `?next=` asks to return to, or `null` when it would leave
 * the app or land back on a signed-out screen. Mirrors `routes::safe_next`.
 */
export function safeNext(next: string | null): string | null {
  if (next === null) return null;
  const isLocalPath =
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !next.includes("://") &&
    ![...next].some((ch) => /\p{Cc}/u.test(ch));
  if (!isLocalPath) return null;
  const pathname = next.split(/[?#]/)[0] ?? "";
  return SIGNED_OUT_PATHS.includes(pathname) ? null : next;
}

/** /login, carrying the page a guest was sent away from. */
export function loginHref(from: string): string {
  return from === "/" ? "/login" : `/login?next=${encodeURIComponent(from)}`;
}
