import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookUuid } from "./api";
import { autoTransition, useAutoReadStatus } from "./autoReadStatus";
import { deferred } from "./testing/handlers";
import { aWireReadStatus } from "./testing/wire";

const BOOK = "book-a" as BookUuid;

describe("autoTransition", () => {
  it.each([
    ["unread", false, "reading"],
    ["reading", false, null],
    ["finished", false, null],
    ["unread", true, "finished"],
    ["reading", true, "finished"],
    ["finished", true, null],
  ] as const)("moves %s at atEnd=%s to %s", (current, atEnd, next) => {
    expect(autoTransition(current, atEnd)).toBe(next);
  });
});

describe("useAutoReadStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets the server store finished last when reading is still in flight", async () => {
    const held = deferred();
    const stored: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "PUT") return Response.json(null);
        const { status } = JSON.parse(String(init.body));
        if (status === "reading") await held.promise;
        stored.push(status);
        return Response.json(aWireReadStatus({ status }));
      }),
    );

    const { rerender } = renderHook(
      ({ atEnd }) => useAutoReadStatus(BOOK, atEnd),
      { initialProps: { atEnd: false } },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    rerender({ atEnd: true });
    held.release();

    await waitFor(() => expect(stored).toEqual(["reading", "finished"]));
  });
});
