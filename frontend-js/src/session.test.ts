import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { toUser, type User } from "./api";
import { endSession, meQuery, startSession } from "./session";
import { WIRE_ADA } from "./testing/wire";

const grace = toUser({ ...WIRE_ADA, id: 2, username: "grace" });

// A write's variables, such as a typed password, stay in the cache after it settles.
async function typedSecret(client: QueryClient) {
  await new MutationObserver(client, {
    mutationFn: async (secret: string) => secret,
  }).mutate("typed-secret");
}

describe("startSession", () => {
  it("drops the answers cached for whoever was signed in before", () => {
    const client = new QueryClient();
    client.setQueryData(["progress", "recent", 1], ["ada's book"]);

    startSession(client, grace);

    expect(client.getQueryData(["progress", "recent", 1])).toBeUndefined();
  });

  it("forgets what the previous user typed into a write", async () => {
    const client = new QueryClient();
    await typedSecret(client);

    startSession(client, grace);

    expect(client.getMutationCache().getAll()).toEqual([]);
  });

  it("makes the new user the session", () => {
    const client = new QueryClient();

    startSession(client, grace);

    expect(client.getQueryData(meQuery.queryKey)).toEqual(grace);
  });
});

describe("endSession", () => {
  it("sends the reader to the login page, replacing the history entry", () => {
    const visits: [string, { replace: true }][] = [];

    endSession(new QueryClient(), (to, options) => {
      visits.push([to, options]);
    });

    expect(visits).toEqual([["/login", { replace: true }]]);
  });

  it("reads the session as a guest rather than as unknown", () => {
    const client = new QueryClient();
    client.setQueryData(meQuery.queryKey, grace);

    endSession(client, () => {});

    expect(client.getQueryData(meQuery.queryKey)).toBeNull();
  });

  it("is not undone by a session read still in flight", async () => {
    const client = new QueryClient();
    client.setQueryData(meQuery.queryKey, grace);
    let answer: (user: User) => void = () => {};
    const inFlight = client.fetchQuery({
      queryKey: meQuery.queryKey,
      queryFn: () => new Promise<User>((resolve) => (answer = resolve)),
    });

    endSession(client, () => {});
    answer(grace);
    await inFlight.catch(() => {});

    expect(client.getQueryData(meQuery.queryKey)).toBeNull();
  });

  it("forgets what was typed into a write", async () => {
    const client = new QueryClient();
    await typedSecret(client);

    endSession(client, () => {});

    expect(client.getMutationCache().getAll()).toEqual([]);
  });

  it("drops every other cached answer", () => {
    const client = new QueryClient();
    client.setQueryData(["progress", "recent", 2], ["grace's book"]);

    endSession(client, () => {});

    expect(client.getQueryData(["progress", "recent", 2])).toBeUndefined();
  });
});
