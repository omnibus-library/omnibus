import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  avatarUrl,
  type BookUuid,
  bumpAvatarBust,
  bumpCoverBust,
  coverUrl,
  parseUserId,
  resetImageBusts,
  thumbSrcSet,
  thumbUrl,
  type UserId,
  utcOffsetMinutes,
} from "./core";

const uuid = (id: string) => id as BookUuid;

describe("cover cache-busting", () => {
  // The bust store is module state, so each test starts from the cover first sent.
  beforeEach(resetImageBusts);

  it("keeps the plain URLs until a write bumps the book", () => {
    const book = uuid("plain");

    expect(coverUrl(book)).toBe("/api/covers/plain");
    expect(thumbUrl(book, "sm")).toBe("/api/thumbs/plain/sm");
  });

  it("appends the generation to every cover URL after a bump", () => {
    const book = uuid("bumped");

    bumpCoverBust(book);

    expect(coverUrl(book)).toBe("/api/covers/bumped?v=1");
    expect(thumbUrl(book)).toBe("/api/thumbs/bumped/md?v=1");
    expect(thumbSrcSet(book)).toBe(
      "/api/thumbs/bumped/sm?v=1 160w, /api/thumbs/bumped/md?v=1 320w, /api/thumbs/bumped/lg?v=1 640w",
    );
  });

  it("counts each write", () => {
    const book = uuid("twice");

    bumpCoverBust(book);
    bumpCoverBust(book);

    expect(coverUrl(book)).toBe("/api/covers/twice?v=2");
  });

  it("leaves other books alone", () => {
    bumpCoverBust(uuid("other"));

    expect(coverUrl(uuid("untouched"))).toBe("/api/covers/untouched");
  });
});

describe("avatar cache-busting", () => {
  beforeEach(resetImageBusts);

  it("keeps the plain URL until a write bumps the reader", () => {
    expect(avatarUrl(7 as UserId)).toBe("/api/users/7/avatar");
  });

  it("appends the generation after a bump, for that reader only", () => {
    bumpAvatarBust(8 as UserId);

    expect(avatarUrl(8 as UserId)).toBe("/api/users/8/avatar?v=1");
    expect(avatarUrl(9 as UserId)).toBe("/api/users/9/avatar");
  });
});

describe("parseUserId", () => {
  it("brands a positive integer", () => {
    expect(parseUserId("2")).toBe(2);
  });

  it.each([
    ["an empty string", ""],
    ["zero", "0"],
    ["a negative number", "-1"],
    ["a decimal", "2.5"],
    ["text", "x"],
    ["a missing parameter", null],
  ])("reads %s as no user", (_case, raw) => {
    expect(parseUserId(raw)).toBeNull();
  });
});

describe("utcOffsetMinutes", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["east of UTC", -120, 120],
    ["west of UTC", 300, -300],
  ])(
    "reports the device %s as east-positive minutes",
    (_zone, getter, want) => {
      // `getTimezoneOffset` is west-positive; the server cuts days on east-positive minutes.
      vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(getter);

      expect(utcOffsetMinutes()).toBe(want);
    },
  );
});
