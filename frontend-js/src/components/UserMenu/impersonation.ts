/** The whole minutes left on an impersonation, rounded up and never below one. */
export function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt * 1000 - now) / 60_000));
}
