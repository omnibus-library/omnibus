import { afterEach, describe, expect, it, vi } from "vitest";
import { aWireAudioBookmark } from "../testing/wire";
import { fetchAudioBookmarks } from "./audio";
import type { BookUuid } from "./core";

const A = "book-a" as BookUuid;

describe("fetchAudioBookmarks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps only positions that are seconds, dropping an ebook's CFI and a blank one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          aWireAudioBookmark({ id: 1, position: "600" }),
          aWireAudioBookmark({ id: 2, position: "epubcfi(/6/4!/4/2/1:0)" }),
          aWireAudioBookmark({ id: 3, position: "" }),
          aWireAudioBookmark({ id: 4, position: " " }),
        ]),
      ),
    );

    const bookmarks = await fetchAudioBookmarks(A);

    expect(bookmarks.map((b) => b.id)).toEqual([1]);
  });
});
