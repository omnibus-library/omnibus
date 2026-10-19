import type { ShelfKind, UserId } from "../../api";
import type { FullList } from "./narrow";

/** Why a shelf is read-only for this viewer. */
export type LockReason =
  /** Someone else's shelf, and the viewer isn't an admin. */
  | { why: "not-owner"; owner: string }
  /** The built-in Wishlist, which fills itself; `own` when it is the viewer's. */
  | { why: "wishlist"; own: boolean; owner: string };

/** What the viewer may do with one shelf. An admin changing another's shelf is allowed but told apart. */
export type ShelfAccess =
  | { kind: "owner" }
  | { kind: "admin" }
  | { kind: "locked"; reason: LockReason };

/** Mirrors `shelf_access.rs`: the owner or an admin may edit, a Wishlist never. */
export function resolveAccess(
  viewer: { id: UserId; isAdmin: boolean },
  shelf: { kind: ShelfKind; owner: { id: UserId; name: string } },
): ShelfAccess {
  const own = viewer.id === shelf.owner.id;
  const owner = shelf.owner.name;
  if (shelf.kind === "wishlist") {
    return { kind: "locked", reason: { why: "wishlist", own, owner } };
  }
  if (own) return { kind: "owner" };
  if (viewer.isAdmin) return { kind: "admin" };
  return { kind: "locked", reason: { why: "not-owner", owner } };
}

/** Whether the edit controls act. */
export const canEdit = (access: ShelfAccess) => access.kind !== "locked";

/** Whether Add books acts, and why not: it waits on the whole member list, which marks what the shelf already holds. `null` when it isn't offered. */
export function addBooksState(
  editable: boolean,
  full: FullList,
): { ready: boolean; title?: string } | null {
  if (!editable) return null;
  if (full.ready) return { ready: true };
  return {
    ready: false,
    title: full.errored
      ? "This shelf’s books couldn’t be loaded."
      : "Still loading this shelf’s books…",
  };
}

/** The one-line refusal. */
export function lockHeadline(reason: LockReason): string {
  if (reason.why === "not-owner") {
    return `You can’t edit this shelf — it belongs to ${reason.owner}.`;
  }
  return reason.own
    ? "Your wishlist can’t be edited here."
    : `${reason.owner}’s wishlist can’t be edited.`;
}

/** What would change it instead. */
export function lockDetail(reason: LockReason): string {
  if (reason.why === "not-owner") {
    return "Only its owner or an admin can rename it, change its books, or delete it.";
  }
  return reason.own
    ? "It fills itself — add a book to your wishlist from the book’s page and it appears here."
    : "A wishlist fills itself from what its owner wishes for.";
}
