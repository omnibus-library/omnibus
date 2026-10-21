import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookUuid } from "../../api";
import { deferred } from "../../testing/handlers";
import { aWireHighlight } from "../../testing/wire";
import { type AnnotationBridge, useHighlights } from "./annotations";

const BOOK = "book-a" as BookUuid;

describe("useHighlights", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("load", () => {
    it("paints nothing and keeps the list unknown when the reader was left before the answer", async () => {
      const held = deferred();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          await held.promise;
          return Response.json([aWireHighlight()]);
        }),
      );
      const bridge: AnnotationBridge = {
        navigate: vi.fn(),
        canNavigate: () => true,
        paint: vi.fn(),
        unpaint: vi.fn(),
        copy: vi.fn(),
      };
      const client = new QueryClient();
      const { result } = renderHook(() => useHighlights(BOOK, bridge), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      let left = false;

      const loading = result.current.load(() => left);
      left = true;
      held.release();
      await act(() => loading);

      expect(bridge.paint).not.toHaveBeenCalled();
      expect(result.current.highlights).toBe("loading");
    });
  });
});
