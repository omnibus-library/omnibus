import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { toUser } from "./api";
import { endSession, meQuery, startSession } from "./session";
import { WIRE_ADA } from "./testing/wire";

const grace = toUser({ ...WIRE_ADA, id: 2, username: "grace" });

describe("startSession", () => {
  it("drops the answers cached for whoever was signed in before", () => {
    const client = new QueryClient();
    client.setQueryData(["progress", "recent", 1], ["ada's book"]);

    startSession(client, grace);

    expect(client.getQueryData(["progress", "recent", 1])).toBeUndefined();
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

  it("drops every other cached answer", () => {
    const client = new QueryClient();
    client.setQueryData(["progress", "recent", 2], ["grace's book"]);

    endSession(client, () => {});

    expect(client.getQueryData(["progress", "recent", 2])).toBeUndefined();
  });
});
