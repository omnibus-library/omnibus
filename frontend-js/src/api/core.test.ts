import { describe, expect, it } from "vitest";
import {
  type BookUuid,
  bumpCoverBust,
  coverUrl,
  thumbSrcSet,
  thumbUrl,
} from "./core";

// The bust store is module state, so each test keeps to a uuid of its own.
const uuid = (id: string) => id as BookUuid;

describe("cover cache-busting", () => {
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
