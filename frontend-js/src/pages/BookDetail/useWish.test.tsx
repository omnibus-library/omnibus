import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { toBookDetail } from "../../api";
import { aWireBook } from "../../testing/wire";
import { useWish, wishlistQuery } from "./queries";

const ENTRY = { addedAt: 1_760_000_000, source: "scan" as const };

/** Renders the hook against a cache that already holds the book's wishlist entry, as a page left open across an import does. */
function renderWish(book: ReturnType<typeof toBookDetail>) {
  const client = new QueryClient();
  client.setQueryData(wishlistQuery(book.uuid).queryKey, ENTRY);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWish(book), { wrapper });
}

describe("useWish", () => {
  it("returns the cached entry for a book with no files", () => {
    const book = toBookDetail(aWireBook({ formats: [], book_files: [] }));
    expect(renderWish(book).result.current).toEqual(ENTRY);
  });

  it("returns null for a book with files when the cache still holds its entry", () => {
    const book = toBookDetail(aWireBook({ formats: ["EPUB"] }));
    expect(renderWish(book).result.current).toBeNull();
  });
});
