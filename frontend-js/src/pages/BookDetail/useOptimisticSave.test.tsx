import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
          if (note === "refused") throw new Error("refused");
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

describe("useOptimisticSave among keys that begin with its own", () => {
  it("leaves a read under a longer key running", async () => {
    const { client, result } = renderSave();
    const child = [...KEY, "child"];
    const read = deferred();
    void client.fetchQuery({
      queryKey: child,
      queryFn: () => read.promise.then(() => "answer"),
    });

    act(() => {
      result.current.mutate("second");
    });
    await waitFor(() => expect(client.getQueryData(KEY)).toBe("saved second"));

    expect(client.getQueryState(child)?.fetchStatus).toBe("fetching");
    read.release();
  });

  it.each([
    ["is saved", "second"],
    ["is refused", "refused"],
  ])(
    "leaves the answer under a longer key fresh when a write %s",
    async (_, note) => {
      const { client, result } = renderSave();
      const child = [...KEY, "child"];
      client.setQueryData(child, "answer");

      act(() => {
        result.current.mutate(note);
      });
      await waitFor(() =>
        expect(result.current.isSuccess || result.current.isError).toBe(true),
      );

      expect(client.getQueryState(child)?.isInvalidated).toBe(false);
    },
  );

  it("refetches when its last write settles although another mutation under a longer key is running", async () => {
    const { client, result } = renderSave();
    const other = deferred();
    void new MutationObserver(client, {
      mutationKey: [...KEY, "other"],
      mutationFn: () => other.promise,
    }).mutate();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    act(() => {
      result.current.mutate("second");
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY, exact: true }),
    );
    other.release();
  });
});
