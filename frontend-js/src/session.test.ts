import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { parseUser } from "./api";
import { meQuery, startSession } from "./session";
import { WIRE_ADA } from "./testing/wire";

const grace = parseUser({ ...WIRE_ADA, id: 2, username: "grace" });

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
