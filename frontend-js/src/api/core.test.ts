import { QueryClient, queryOptions } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type BookUuid,
  bumpCoverBust,
  coverUrl,
  replaceQueryData,
  resetCoverBusts,
  thumbSrcSet,
  thumbUrl,
} from "./core";

const uuid = (id: string) => id as BookUuid;

describe("cover cache-busting", () => {
  // The bust store is module state, so each test starts from the cover first sent.
  beforeEach(resetCoverBusts);

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

describe("replaceQueryData", () => {
  const thing = (read: () => Promise<string>) =>
    queryOptions({ queryKey: ["thing"], queryFn: read });

  it("stores the answer in place of the cached read", async () => {
    const client = new QueryClient();
    const { queryKey } = thing(async () => "stale");
    client.setQueryData(queryKey, "stale");

    await replaceQueryData(client, queryKey, "answer");

    expect(client.getQueryData(queryKey)).toBe("answer");
  });

  it("keeps an older read still in flight from landing over the answer", async () => {
    const client = new QueryClient();
    let reply: (value: string) => void = () => {};
    const late = new Promise<string>((resolve) => {
      reply = resolve;
    });
    const options = thing(() => late);
    const inFlight = client.fetchQuery(options).catch(() => {});

    await replaceQueryData(client, options.queryKey, "answer");
    reply("stale");
    await inFlight;

    expect(client.getQueryData(options.queryKey)).toBe("answer");
  });
});
