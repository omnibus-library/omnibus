import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { toUser } from "../../api";
import { startSession } from "../../session";
import { deferred } from "../../testing/handlers";
import { WIRE_ADA } from "../../testing/wire";
import { useOptimisticSave } from "./useOptimisticSave";

const KEY = ["book", "u", "reviews"];
const grace = toUser({ ...WIRE_ADA, id: 2, username: "grace" });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A save whose "first" write is held until `held.release()`, recording every write it sends. */
function renderSave() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const held = deferred();
  const sent: string[] = [];
  const onFailure = vi.fn();
  const { result } = renderHook(
    () =>
      useOptimisticSave<string, string>(
        KEY,
        async (note) => {
          sent.push(note);
          if (note === "first") await held.promise;
          return `saved ${note}`;
        },
        {
          optimistic: (note) => `guess ${note}`,
          alsoInvalidate: [["stats"]],
          onFailure,
        },
      ),
    { wrapper },
  );
  return { client, held, sent, onFailure, result };
}

describe("useOptimisticSave across an account switch", () => {
  it("never sends a write still queued when another account signs in", async () => {
    const { client, held, sent, onFailure, result } = renderSave();
    act(() => {
      result.current.mutate("first");
      result.current.mutate("ada's private notes");
    });
    await waitFor(() => expect(sent).toEqual(["first"]));

    startSession(client, grace);
    held.release();
    await settle();

    expect(sent).toEqual(["first"]);
    // The dropped write is not the new reader's failure to hear about.
    expect(onFailure).not.toHaveBeenCalled();
    expect(client.getQueryData(KEY)).toBeUndefined();
  });

  it("caches nothing from an answer that lands after the switch", async () => {
    const { client, held, result } = renderSave();
    act(() => {
      result.current.mutate("first");
    });
    await waitFor(() => expect(client.getQueryData(KEY)).toBe("guess first"));
    const invalidate = vi.spyOn(client, "invalidateQueries");

    startSession(client, grace);
    held.release();
    await settle();

    expect(client.getQueryData(KEY)).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("settles as usual within one session", async () => {
    const { client, held, result } = renderSave();
    act(() => {
      result.current.mutate("first");
    });
    held.release();

    await waitFor(() => expect(client.getQueryData(KEY)).toBe("saved first"));
  });
});
