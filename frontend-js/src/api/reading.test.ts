import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../testing/handlers";
import { aWirePosition } from "../testing/wire";
import type { BookUuid } from "./core";
import { saveReadingPosition } from "./reading";

const A = "book-a" as BookUuid;
const B = "book-b" as BookUuid;

/** A server that finishes each POST in the order it is done with it; the 10% one is held until `gate`. */
function stubProgressServer(gate: Promise<void>) {
  const processed: number[] = [];
  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    const { progress_percent } = JSON.parse(String(init?.body));
    if (progress_percent === 10) await gate;
    processed.push(progress_percent);
    return progress_percent === 99
      ? new Response("boom", { status: 500 })
      : Response.json(aWirePosition());
  });
  vi.stubGlobal("fetch", fetchStub);
  return processed;
}

describe("saveReadingPosition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("ordering", () => {
    it("lets the server finish a book's writes in the order they were sent", async () => {
      const held = deferred();
      const processed = stubProgressServer(held.promise);

      const first = saveReadingPosition(A, { anchor: "a", percent: 10 });
      const second = saveReadingPosition(A, { anchor: "b", percent: 20 });
      held.release();
      await Promise.all([first, second]);

      expect(processed).toEqual([10, 20]);
    });

    it("does not hold another book's write behind a held one", async () => {
      const held = deferred();
      const processed = stubProgressServer(held.promise);

      const first = saveReadingPosition(A, { anchor: "a", percent: 10 });
      await saveReadingPosition(B, { anchor: "b", percent: 20 });
      held.release();
      await first;

      expect(processed).toEqual([20, 10]);
    });

    it("sends the next write after one that failed and tells each caller its own result", async () => {
      const processed = stubProgressServer(Promise.resolve());

      const failed = saveReadingPosition(A, { anchor: "a", percent: 99 });
      const next = saveReadingPosition(A, { anchor: "b", percent: 20 });

      await expect(failed).rejects.toMatchObject({ status: 500 });
      await expect(next).resolves.toBeUndefined();
      expect(processed).toEqual([99, 20]);
    });
  });
});
