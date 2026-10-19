import { describe, expect, it } from "vitest";
import type { UserId } from "../../api";
import {
  canEdit,
  lockDetail,
  lockHeadline,
  resolveAccess,
} from "./shelfAccess";

const id = (n: number) => n as UserId;
const shelf = (kind: "manual" | "smart" | "wishlist") => ({
  kind,
  owner: { id: id(1), name: "Alice" },
});
const reason = (access: ReturnType<typeof resolveAccess>) => {
  if (access.kind !== "locked") throw new Error("expected a locked shelf");
  return access.reason;
};

describe("resolveAccess", () => {
  it("gives the owner full access", () => {
    const access = resolveAccess({ id: id(1), isAdmin: false }, shelf("smart"));

    expect(access).toEqual({ kind: "owner" });
    expect(canEdit(access)).toBe(true);
  });

  it("lets an admin change someone else's shelf", () => {
    const access = resolveAccess({ id: id(9), isAdmin: true }, shelf("manual"));

    expect(access).toEqual({ kind: "admin" });
    expect(canEdit(access)).toBe(true);
  });

  it("locks a stranger's shelf and names its owner", () => {
    const access = resolveAccess(
      { id: id(9), isAdmin: false },
      shelf("manual"),
    );

    expect(canEdit(access)).toBe(false);
    expect(lockHeadline(reason(access))).toBe(
      "You can’t edit this shelf — it belongs to Alice.",
    );
    expect(lockDetail(reason(access))).toBe(
      "Only its owner or an admin can rename it, change its books, or delete it.",
    );
  });

  it("locks a wishlist even for its owner and for admins", () => {
    const own = resolveAccess({ id: id(1), isAdmin: true }, shelf("wishlist"));
    const theirs = resolveAccess(
      { id: id(9), isAdmin: true },
      shelf("wishlist"),
    );

    expect(canEdit(own)).toBe(false);
    expect(lockHeadline(reason(own))).toBe(
      "Your wishlist can’t be edited here.",
    );
    expect(lockDetail(reason(own))).toBe(
      "It fills itself — add a book to your wishlist from the book’s page and it appears here.",
    );
    expect(canEdit(theirs)).toBe(false);
    expect(lockHeadline(reason(theirs))).toBe(
      "Alice’s wishlist can’t be edited.",
    );
    expect(lockDetail(reason(theirs))).toBe(
      "A wishlist fills itself from what its owner wishes for.",
    );
  });
});
